import { afterAll, afterEach, describe, expect, test } from "bun:test";

import {
  createMarketplaceDb,
  hubConfigOutbox,
  hubGroupModels,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubModels,
  hubProviderGroups,
  hubProviders,
  hubRelayChannelBindings,
  listHubRelayChannelBindings,
} from "@llmhub/marketplace-db";
import { encryptSecret } from "@openstatus/services/radar/runtime";
import { eq, inArray } from "drizzle-orm";

import { clearHubRoutingAndBillingTestData } from "../../../packages/marketplace-db/src/test-helpers";
import {
  runHubConfigSyncBatch,
  type HubRelayAdapter,
} from "./relay-config-sync";

const configuredUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const databaseUrl =
  configuredUrl &&
  /(^|[_-])test([_-]|$)/i.test(
    new URL(configuredUrl).pathname.split("/").at(-1) ?? "",
  )
    ? configuredUrl
    : undefined;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("LLMHub relay config sync worker", () => {
  if (!databaseUrl) return;
  const { client, db } = createMarketplaceDb(databaseUrl);
  const providerIds: string[] = [];
  const groupIds: string[] = [];
  const modelIds: string[] = [];

  afterEach(async () => {
    await clearHubRoutingAndBillingTestData(db);
    if (groupIds.length > 0) {
      await db
        .update(hubGroupModels)
        .set({ relayChannelBindingId: null, updatedAt: new Date() })
        .where(inArray(hubGroupModels.groupId, groupIds));
      await db
        .delete(hubRelayChannelBindings)
        .where(inArray(hubRelayChannelBindings.groupId, groupIds));
      await db
        .delete(hubConfigOutbox)
        .where(inArray(hubConfigOutbox.groupId, groupIds));
      await db
        .delete(hubGroupModels)
        .where(inArray(hubGroupModels.groupId, groupIds));
      await db
        .delete(hubGroupPriceVersions)
        .where(inArray(hubGroupPriceVersions.groupId, groupIds));
      await db
        .delete(hubGroupSecrets)
        .where(inArray(hubGroupSecrets.groupId, groupIds));
      await db
        .delete(hubProviderGroups)
        .where(inArray(hubProviderGroups.id, groupIds));
      groupIds.length = 0;
    }
    if (modelIds.length > 0) {
      await db.delete(hubModels).where(inArray(hubModels.id, modelIds));
      modelIds.length = 0;
    }
    if (providerIds.length > 0) {
      await db
        .delete(hubProviders)
        .where(inArray(hubProviders.id, providerIds));
      providerIds.length = 0;
    }
  });

  afterAll(async () => {
    await client.close();
  });

  test("applies an outbox task through the adapter and records its binding", async () => {
    const suffix = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const modelId = crypto.randomUUID();
    providerIds.push(providerId);
    groupIds.push(groupId);
    modelIds.push(modelId);

    const [baseUrlCiphertext, apiKeyCiphertext] = await Promise.all([
      encryptSecret("https://relay-test.example.com/v1"),
      encryptSecret("sk-relay-test"),
    ]);
    await db.insert(hubProviders).values({
      id: providerId,
      ownerWorkspaceId: `workspace-${suffix}`,
      slug: `provider-${suffix}`,
      name: "Relay Test",
      displayName: "Relay Test",
    });
    await db.insert(hubProviderGroups).values({
      id: groupId,
      providerId,
      name: "Pro",
      baseUrlCiphertext,
      baseUrlHostHash: `host-${suffix}`,
      lifecycleStatus: "ready",
      desiredStatus: "active",
      listingStatus: "listed",
      configVersion: 1,
    });
    await db.insert(hubGroupSecrets).values({
      groupId,
      apiKeyCiphertext,
      keyFingerprint: `fingerprint-${suffix}`,
      lastFour: "test",
    });
    await db.insert(hubGroupPriceVersions).values({
      groupId,
      multiplierBps: 7_500,
      effectiveFrom: new Date(0),
      changeReason: "relay config sync test",
    });
    await db.insert(hubModels).values({
      id: modelId,
      slug: `gpt-test-${suffix}`,
      vendor: "openai",
      family: "gpt",
      canonicalName: `gpt-test-${suffix}`,
      displayName: "GPT Test",
      shortName: "GPT Test",
    });
    await db.insert(hubGroupModels).values({
      groupId,
      modelId,
      upstreamModelName: "upstream-gpt-test",
      normalizedUpstreamName: "upstream-gpt-test",
      discoveryStatus: "active",
      trafficEnabled: true,
      probeEnabled: true,
    });
    await db.insert(hubConfigOutbox).values({
      groupId,
      configVersion: 1,
      action: "upsert",
      nextAttemptAt: new Date(0),
    });

    const routes: string[] = [];
    const adapter: HubRelayAdapter = {
      async upsertRoute(route) {
        routes.push(route.sourceRef);
        return { externalChannelId: `fake-${route.routeKey}` };
      },
      async disableRoute() {},
    };
    expect(await runHubConfigSyncBatch(db, adapter)).toEqual({ claimed: 1 });

    expect(routes).toHaveLength(1);
    expect(await listHubRelayChannelBindings(db, groupId)).toEqual([
      expect.objectContaining({
        groupId,
        externalChannelId: expect.stringContaining("fake-"),
        appliedConfigVersion: 1,
        active: true,
      }),
    ]);
    const [groupModel] = await db
      .select({ relayChannelBindingId: hubGroupModels.relayChannelBindingId })
      .from(hubGroupModels)
      .where(eq(hubGroupModels.groupId, groupId));
    const [binding] = await listHubRelayChannelBindings(db, groupId);
    expect(groupModel?.relayChannelBindingId).toBe(binding?.id);
    const [task] = await db
      .select()
      .from(hubConfigOutbox)
      .where(eq(hubConfigOutbox.groupId, groupId));
    expect(task).toEqual(
      expect.objectContaining({ status: "applied", attempts: 1 }),
    );
  });
});
