import { beforeEach, describe, expect, test } from "bun:test";

import { desc, eq } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import {
  createHubGroup,
  HubGroupNotFoundError,
  listHubGroups,
  mapHubGroupModel,
  requestHubGroupListing,
  reviewHubGroupListing,
  setHubGroupModelBaseUrlOverride,
  setHubGroupState,
  updateHubGroup,
  withdrawHubGroupListing,
} from "./groups";
import {
  hubConfigOutbox,
  hubGroupModels,
  hubGroupModelStats,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubHealthBuckets3h,
  hubModelAliases,
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
  hubProviderGroups,
  hubProbeCycles,
  hubProbeRuns,
  hubProbeTargets,
  hubProviders,
  hubRelayChannelBindings,
} from "./schema";
import { clearHubRoutingAndBillingTestData } from "./test-helpers";

const configuredUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const databaseUrl =
  configuredUrl &&
  /(^|[_-])test([_-]|$)/i.test(
    new URL(configuredUrl).pathname.split("/").at(-1) ?? "",
  )
    ? configuredUrl
    : undefined;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("LLMHub v2 group repository", () => {
  if (!databaseUrl) return;
  const { db } = createMarketplaceDb(databaseUrl);

  beforeEach(async () => {
    await clearHubRoutingAndBillingTestData(db);
    await db.delete(hubProbeRuns);
    await db.delete(hubProbeCycles);
    await db.delete(hubGroupModelStats);
    await db.delete(hubHealthBuckets3h);
    await db.delete(hubProbeTargets);
    await db.delete(hubGroupModels);
    await db.delete(hubGroupPriceVersions);
    await db.delete(hubGroupSecrets);
    await db.delete(hubRelayChannelBindings);
    await db.delete(hubConfigOutbox);
    await db.delete(hubProviderGroups);
    await db.delete(hubModelAliases);
    await db.delete(hubModelPriceComponents);
    await db.delete(hubModelPriceVersions);
    await db.delete(hubModels);
    await db.delete(hubProviders);
  });

  test("creates catalog records for newly discovered models", async () => {
    const modelId = await seedCatalogModel();
    const created = await createTestGroup(["gpt-5.5", "vendor-special"]);
    const [group] = await listHubGroups(db, "workspace-test");

    expect(group?.id).toBe(created.id);
    expect(group?.multiplierBps).toBe(7_500);
    expect(group?.models).toEqual([
      expect.objectContaining({
        modelId,
        upstreamName: "gpt-5.5",
        discoveryStatus: "active",
        probeEnabled: true,
      }),
      expect.objectContaining({
        upstreamName: "vendor-special",
        canonicalName: "vendor-special",
        displayName: "Vendor Special",
        discoveryStatus: "active",
        trafficEnabled: false,
        probeEnabled: true,
      }),
    ]);
  });

  test("versions multipliers and enforces pause, resume and retirement", async () => {
    await seedCatalogModel();
    const group = await createTestGroup(["gpt-5.5"]);

    await updateHubGroup(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      multiplierBps: 6_200,
    });
    expect((await listHubGroups(db, "workspace-test"))[0]?.multiplierBps).toBe(
      6_200,
    );

    await setHubGroupState(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      action: "pause",
    });
    expect((await listHubGroups(db, "workspace-test"))[0]?.desiredStatus).toBe(
      "paused",
    );

    await setHubGroupState(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      action: "resume",
    });
    await setHubGroupState(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      action: "retire",
    });
    const [retired] = await listHubGroups(db, "workspace-test");
    expect(retired?.lifecycleStatus).toBe("retired");
    expect(retired?.listingStatus).toBe("delisted");
    expect(retired?.models[0]?.probeEnabled).toBe(false);
  });

  test("retires a model after three missing catalogs and restores it when rediscovered", async () => {
    await seedCatalogModel();
    const group = await createTestGroup(["gpt-5.5"]);

    for (let count = 0; count < 3; count += 1) {
      await updateHubGroup(db, {
        ownerWorkspaceId: "workspace-test",
        groupId: group.id,
        discoveredModels: [],
      });
    }
    expect(
      (await listHubGroups(db, "workspace-test"))[0]?.models[0]
        ?.discoveryStatus,
    ).toBe("retired");

    await updateHubGroup(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      discoveredModels: ["gpt-5.5"],
    });
    expect((await listHubGroups(db, "workspace-test"))[0]?.models[0]).toEqual(
      expect.objectContaining({
        discoveryStatus: "active",
        probeEnabled: true,
      }),
    );
  });

  test("supports remapping provider-specific model names", async () => {
    const modelId = await seedCatalogModel();
    await createTestGroup(["provider-gpt-latest"]);
    const groupModel = (await listHubGroups(db, "workspace-test"))[0]
      ?.models[0];
    expect(groupModel).toEqual(
      expect.objectContaining({
        canonicalName: "provider-gpt-latest",
        discoveryStatus: "active",
      }),
    );
    if (!groupModel) return;

    await mapHubGroupModel(db, {
      ownerWorkspaceId: "workspace-test",
      groupModelId: groupModel.id,
      modelId,
      probeEnabled: true,
    });
    expect((await listHubGroups(db, "workspace-test"))[0]?.models[0]).toEqual(
      expect.objectContaining({
        modelId,
        discoveryStatus: "active",
        probeEnabled: true,
      }),
    );
  });

  test("invalidates every model snapshot when one mapping changes", async () => {
    const modelId = await seedCatalogModel();
    await createTestGroup(["provider-gpt-latest", "vendor-special"]);
    const models = (await listHubGroups(db, "workspace-test"))[0]?.models ?? [];
    expect(models).toHaveLength(2);
    for (const model of models) {
      await db.insert(hubGroupModelStats).values({
        groupModelId: model.id,
        windowStart: new Date(Date.now() - 60_000),
        windowEnd: new Date(),
        availabilityBps: 10_000,
        coverageBps: 10_000,
        sampleCount: 4,
        validBucketCount: 1,
        rankingScoreBps: 9_000,
        currentStatus: "normal",
        eligible: true,
      });
      await db.insert(hubHealthBuckets3h).values({
        groupModelId: model.id,
        bucketStart: new Date("2026-08-02T06:00:00.000Z"),
        expectedCount: 1,
        attemptedCount: 1,
        successCount: 1,
        availabilityBps: 10_000,
        coverageBps: 10_000,
      });
    }
    const remapped = models.find(
      (model) => model.upstreamName === "provider-gpt-latest",
    );
    if (!remapped) return;

    await mapHubGroupModel(db, {
      ownerWorkspaceId: "workspace-test",
      groupModelId: remapped.id,
      modelId,
      probeEnabled: true,
    });

    expect(await db.select().from(hubGroupModelStats)).toHaveLength(0);
    expect(await db.select().from(hubHealthBuckets3h)).toHaveLength(0);
  });

  test("invalidates derived health only when the effective config changes", async () => {
    await seedCatalogModel();
    const group = await createTestGroup(["gpt-5.5"]);
    const [before] = await listHubGroups(db, "workspace-test");
    const groupModel = before?.models[0];
    if (!groupModel) return;
    await db.insert(hubGroupModelStats).values({
      groupModelId: groupModel.id,
      windowStart: new Date(Date.now() - 60_000),
      windowEnd: new Date(),
      availabilityBps: 10_000,
      coverageBps: 10_000,
      sampleCount: 4,
      validBucketCount: 1,
      rankingScoreBps: 9_000,
      currentStatus: "normal",
      eligible: true,
    });

    await updateHubGroup(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      discoveredModels: ["gpt-5.5"],
    });
    expect(await db.select().from(hubGroupModelStats)).toHaveLength(1);
    expect((await listHubGroups(db, "workspace-test"))[0]?.configVersion).toBe(
      before?.configVersion,
    );

    await updateHubGroup(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      baseUrlCiphertext: "ciphertext-v2",
      baseUrlHostHash: "host-hash-v2",
    });
    expect(await db.select().from(hubGroupModelStats)).toHaveLength(0);
    expect((await listHubGroups(db, "workspace-test"))[0]).toEqual(
      expect.objectContaining({
        configVersion: (before?.configVersion ?? 0) + 1,
        lifecycleStatus: "verifying",
      }),
    );
  });

  test("serializes concurrent mappings to the same catalog model", async () => {
    const modelId = await seedCatalogModel();
    await createTestGroup(["provider-model-a", "provider-model-b"]);
    const models = (await listHubGroups(db, "workspace-test"))[0]?.models ?? [];
    expect(models).toHaveLength(2);

    const results = await Promise.allSettled(
      models.map((model) =>
        mapHubGroupModel(db, {
          ownerWorkspaceId: "workspace-test",
          groupModelId: model.id,
          modelId,
          probeEnabled: true,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  test("supports listing request, withdrawal and approval", async () => {
    await seedCatalogModel();
    const group = await createTestGroup(["gpt-5.5"]);
    await markGroupReady(group.id);

    await requestHubGroupListing(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
    });
    expect((await listHubGroups(db, "workspace-test"))[0]).toEqual(
      expect.objectContaining({
        listingStatus: "pending",
        listingSubmittedAt: expect.any(Date),
      }),
    );

    await withdrawHubGroupListing(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
    });
    expect((await listHubGroups(db, "workspace-test"))[0]?.listingStatus).toBe(
      "private",
    );

    await requestHubGroupListing(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
    });
    await reviewHubGroupListing(db, {
      groupId: group.id,
      decision: "approve",
      reviewer: "admin-test",
    });

    const [listed] = await listHubGroups(db, "workspace-test");
    expect(listed).toEqual(
      expect.objectContaining({
        listingStatus: "listed",
        listingReviewedAt: expect.any(Date),
        listingReviewedBy: "admin-test",
        listingReviewNote: null,
      }),
    );
    expect(listed?.models[0]?.trafficEnabled).toBe(true);
    expect((await latestOutboxAction(group.id))?.action).toBe("upsert");
  });

  test("requires a note when rejecting a listing request", async () => {
    await seedCatalogModel();
    const group = await createTestGroup(["gpt-5.5"]);
    await markGroupReady(group.id);
    await requestHubGroupListing(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
    });

    await expect(
      reviewHubGroupListing(db, {
        groupId: group.id,
        decision: "reject",
        reviewer: "admin-test",
        note: "   ",
      }),
    ).rejects.toThrow("A rejection note is required");
    expect((await listHubGroups(db, "workspace-test"))[0]?.listingStatus).toBe(
      "pending",
    );

    await reviewHubGroupListing(db, {
      groupId: group.id,
      decision: "reject",
      reviewer: "admin-test",
      note: "  鉴权方式不符合要求  ",
    });
    const [rejected] = await listHubGroups(db, "workspace-test");
    expect(rejected).toEqual(
      expect.objectContaining({
        listingStatus: "private",
        listingReviewedBy: "admin-test",
        listingReviewNote: "鉴权方式不符合要求",
      }),
    );
    expect(rejected?.models[0]?.trafficEnabled).toBe(false);
    expect((await latestOutboxAction(group.id))?.action).toBe("disable");
  });

  test("does not approve a group with an unpriced active model", async () => {
    await seedCatalogModel(false);
    const group = await createTestGroup(["gpt-5.5"]);
    await markGroupReady(group.id);
    await requestHubGroupListing(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
    });

    await expect(
      reviewHubGroupListing(db, {
        groupId: group.id,
        decision: "approve",
        reviewer: "admin-test",
      }),
    ).rejects.toThrow("Every active model requires input and output prices");
    expect((await listHubGroups(db, "workspace-test"))[0]?.listingStatus).toBe(
      "pending",
    );
  });

  test("returns a listed group to pending and disables traffic after config changes", async () => {
    await seedCatalogModel();
    const group = await createListedGroup();
    const [before] = await listHubGroups(db, "workspace-test");

    await updateHubGroup(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
      baseUrlCiphertext: "listed-group-base-url-v2",
      baseUrlHostHash: "listed-group-host-hash-v2",
    });

    const [changed] = await listHubGroups(db, "workspace-test");
    expect(changed).toEqual(
      expect.objectContaining({
        lifecycleStatus: "verifying",
        listingStatus: "pending",
        listingReviewedAt: null,
        listingReviewedBy: null,
        configVersion: (before?.configVersion ?? 0) + 1,
      }),
    );
    expect(changed?.models[0]?.trafficEnabled).toBe(false);
    expect((await latestOutboxAction(group.id))?.action).toBe("disable");
  });

  test("sets, no-ops and clears a model Base URL override with ownership checks", async () => {
    await seedCatalogModel();
    await createTestGroup(["gpt-5.5"]);
    const [initial] = await listHubGroups(db, "workspace-test");
    const groupModel = initial?.models[0];
    if (!groupModel) throw new Error("Unable to seed group model");

    await expect(
      setHubGroupModelBaseUrlOverride(db, {
        ownerWorkspaceId: "workspace-other",
        groupModelId: groupModel.id,
        baseUrlOverrideCiphertext: "other-ciphertext",
        baseUrlOverrideHostHash: "other-host-hash",
      }),
    ).rejects.toBeInstanceOf(HubGroupNotFoundError);

    const setResult = await setHubGroupModelBaseUrlOverride(db, {
      ownerWorkspaceId: "workspace-test",
      groupModelId: groupModel.id,
      baseUrlOverrideCiphertext: "model-base-url-ciphertext",
      baseUrlOverrideHostHash: "model-base-url-host-hash",
    });
    expect(setResult.changed).toBe(true);
    const [afterSet] = await listHubGroups(db, "workspace-test");
    expect(afterSet).toEqual(
      expect.objectContaining({
        configVersion: (initial?.configVersion ?? 0) + 1,
        lifecycleStatus: "verifying",
      }),
    );
    expect(afterSet?.models[0]?.baseUrlOverrideCiphertext).toBe(
      "model-base-url-ciphertext",
    );

    const noOpResult = await setHubGroupModelBaseUrlOverride(db, {
      ownerWorkspaceId: "workspace-test",
      groupModelId: groupModel.id,
      baseUrlOverrideCiphertext: "ciphertext-that-must-not-replace-the-value",
      baseUrlOverrideHostHash: "model-base-url-host-hash",
    });
    expect(noOpResult.changed).toBe(false);
    const [afterNoOp] = await listHubGroups(db, "workspace-test");
    expect(afterNoOp?.configVersion).toBe(afterSet?.configVersion);
    expect(afterNoOp?.models[0]?.baseUrlOverrideCiphertext).toBe(
      "model-base-url-ciphertext",
    );

    const clearResult = await setHubGroupModelBaseUrlOverride(db, {
      ownerWorkspaceId: "workspace-test",
      groupModelId: groupModel.id,
      baseUrlOverrideCiphertext: null,
      baseUrlOverrideHostHash: null,
    });
    expect(clearResult.changed).toBe(true);
    const [afterClear] = await listHubGroups(db, "workspace-test");
    expect(afterClear?.configVersion).toBe((afterSet?.configVersion ?? 0) + 1);
    expect(afterClear?.models[0]?.baseUrlOverrideCiphertext).toBeNull();
  });

  async function seedCatalogModel(withPrice = true) {
    const [model] = await db
      .insert(hubModels)
      .values({
        slug: "gpt-5-5",
        vendor: "OpenAI",
        family: "GPT",
        canonicalName: "gpt-5.5",
        displayName: "GPT 5.5",
        shortName: "GPT 5.5",
      })
      .returning({ id: hubModels.id });
    if (!model) throw new Error("Unable to seed catalog model");
    await db.insert(hubModelAliases).values({
      modelId: model.id,
      alias: "gpt-5.5",
      normalizedAlias: "gpt-5.5",
    });
    if (withPrice) {
      const [price] = await db
        .insert(hubModelPriceVersions)
        .values({
          modelId: model.id,
          currency: "USD",
          billingMode: "token",
          source: "groups-test",
          changeReason: "Complete test price",
          effectiveFrom: new Date(Date.now() - 1_000),
        })
        .returning({ id: hubModelPriceVersions.id });
      if (!price) throw new Error("Unable to seed model price");
      await db.insert(hubModelPriceComponents).values([
        {
          priceVersionId: price.id,
          component: "input_text",
          unit: "million_tokens",
          amountMicros: 1_000_000n,
        },
        {
          priceVersionId: price.id,
          component: "output_text",
          unit: "million_tokens",
          amountMicros: 2_000_000n,
        },
      ]);
    }
    return model.id;
  }

  function createTestGroup(discoveredModels: string[]) {
    return createHubGroup(db, {
      ownerWorkspaceId: "workspace-test",
      providerSlug: "workspace-test-provider",
      providerName: "Workspace Test Provider",
      name: "Pro",
      baseUrlCiphertext: "encrypted-base-url",
      baseUrlHostHash: "base-url-host-hash",
      apiKeyCiphertext: "encrypted-api-key",
      keyFingerprint: "api-key-fingerprint",
      apiKeyLastFour: "test",
      multiplierBps: 7_500,
      discoveredModels,
    });
  }

  async function markGroupReady(groupId: string) {
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready" })
      .where(eq(hubProviderGroups.id, groupId));
  }

  async function createListedGroup() {
    const group = await createTestGroup(["gpt-5.5"]);
    await markGroupReady(group.id);
    await requestHubGroupListing(db, {
      ownerWorkspaceId: "workspace-test",
      groupId: group.id,
    });
    await reviewHubGroupListing(db, {
      groupId: group.id,
      decision: "approve",
      reviewer: "admin-test",
    });
    return group;
  }

  async function latestOutboxAction(groupId: string) {
    const [row] = await db
      .select({
        action: hubConfigOutbox.action,
        configVersion: hubConfigOutbox.configVersion,
      })
      .from(hubConfigOutbox)
      .where(eq(hubConfigOutbox.groupId, groupId))
      .orderBy(
        desc(hubConfigOutbox.configVersion),
        desc(hubConfigOutbox.createdAt),
      )
      .limit(1);
    return row;
  }
});
