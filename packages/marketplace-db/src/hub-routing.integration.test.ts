import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { eq, inArray, like } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import {
  authorizeHubUsage,
  capturePendingHubUsageSettlements,
  getHubLedgerBalance,
  HubInsufficientBalanceError,
  postHubManualCredit,
  postHubUsageCharge,
  quoteHubUsageAuthorization,
  releaseExpiredHubUsageAuthorizations,
  releaseHubUsageAuthorization,
  stageHubUsageSettlement,
} from "./hub-billing";
import {
  createHubApiToken,
  createHubGroup,
  createHubRequest,
  finishHubRequest,
  listHubUserRequestActivity,
  listHubTokenGroupPreferences,
  planHubRoute,
  replaceHubTokenGroupPreferences,
} from "./index";
import {
  hubApiTokens,
  hubBillingAuthorizations,
  hubGroupModels,
  hubGroupModelStats,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubLedgerAccounts,
  hubLedgerJournals,
  hubLedgerLines,
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
  hubProviderGroups,
  hubProviders,
  hubRelayChannelBindings,
  hubRequestAttempts,
  hubRequests,
  hubProbeTargets,
  hubTokenGroupPreferences,
  hubUsageRecords,
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

describeDatabase("LLMHub token routing and billing", () => {
  if (!databaseUrl) return;
  const { db, client } = createMarketplaceDb(databaseUrl);
  let groupIds: string[] = [];
  let tokenIds: string[] = [];

  beforeEach(async () => {
    await clearHubRoutingAndBillingTestData(db);
    const providers = await db
      .select({ id: hubProviders.id })
      .from(hubProviders)
      .where(like(hubProviders.slug, "routing-test-%"));
    const providerIds = providers.map((provider) => provider.id);
    const groups =
      providerIds.length > 0
        ? await db
            .select({ id: hubProviderGroups.id })
            .from(hubProviderGroups)
            .where(inArray(hubProviderGroups.providerId, providerIds))
        : [];
    groupIds = groups.map((group) => group.id);
    const oldTokens = await db
      .select({ id: hubApiTokens.id })
      .from(hubApiTokens)
      .where(like(hubApiTokens.ownerUserId, "routing-test-%"));
    tokenIds = oldTokens.map((token) => token.id);

    if (tokenIds.length > 0) {
      await db
        .delete(hubTokenGroupPreferences)
        .where(inArray(hubTokenGroupPreferences.tokenId, tokenIds));
      const requests = await db
        .select({ id: hubRequests.id })
        .from(hubRequests)
        .where(inArray(hubRequests.tokenId, tokenIds));
      if (requests.length > 0) {
        await db.delete(hubRequestAttempts).where(
          inArray(
            hubRequestAttempts.requestId,
            requests.map((request) => request.id),
          ),
        );
        await db.delete(hubUsageRecords).where(
          inArray(
            hubUsageRecords.requestId,
            requests.map((request) => request.id),
          ),
        );
        await db.delete(hubRequests).where(
          inArray(
            hubRequests.id,
            requests.map((request) => request.id),
          ),
        );
      }
      await db.delete(hubApiTokens).where(inArray(hubApiTokens.id, tokenIds));
    }
    if (groupIds.length > 0) {
      const oldGroupModels = await groupModelIds(db, groupIds);
      const requests = await db
        .select({ id: hubRequests.id })
        .from(hubRequests)
        .where(inArray(hubRequests.finalGroupModelId, oldGroupModels));
      if (requests.length > 0) {
        await db.delete(hubRequestAttempts).where(
          inArray(
            hubRequestAttempts.requestId,
            requests.map((request) => request.id),
          ),
        );
        await db.delete(hubUsageRecords).where(
          inArray(
            hubUsageRecords.requestId,
            requests.map((request) => request.id),
          ),
        );
        await db.delete(hubRequests).where(
          inArray(
            hubRequests.id,
            requests.map((request) => request.id),
          ),
        );
      }
      const groupModels = oldGroupModels;
      if (groupModels.length > 0) {
        await db
          .delete(hubUsageRecords)
          .where(inArray(hubUsageRecords.finalGroupModelId, groupModels));
        await db
          .delete(hubRequestAttempts)
          .where(inArray(hubRequestAttempts.groupModelId, groupModels));
        await db
          .delete(hubGroupModelStats)
          .where(inArray(hubGroupModelStats.groupModelId, groupModels));
        await db
          .delete(hubProbeTargets)
          .where(inArray(hubProbeTargets.groupModelId, groupModels));
      }
      await db
        .update(hubGroupModels)
        .set({ relayChannelBindingId: null, updatedAt: new Date() })
        .where(inArray(hubGroupModels.groupId, groupIds));
      await db
        .delete(hubRelayChannelBindings)
        .where(inArray(hubRelayChannelBindings.groupId, groupIds));
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
    }
    if (providerIds.length > 0) {
      await db
        .delete(hubProviders)
        .where(inArray(hubProviders.id, providerIds));
    }
    await db.delete(hubLedgerLines);
    await db.delete(hubLedgerJournals);
    await db.delete(hubLedgerAccounts);
    await db
      .delete(hubModelPriceComponents)
      .where(
        inArray(
          hubModelPriceComponents.priceVersionId,
          db
            .select({ id: hubModelPriceVersions.id })
            .from(hubModelPriceVersions)
            .where(like(hubModelPriceVersions.changeReason, "routing-test-%")),
        ),
      );
    await db
      .delete(hubModelPriceVersions)
      .where(like(hubModelPriceVersions.changeReason, "routing-test-%"));
    await db.delete(hubModels).where(like(hubModels.slug, "routing-test-%"));
  });

  afterAll(async () => {
    await client.close();
  });

  test("subscribed groups are preferred and route candidates are capped", async () => {
    const setup = await seedRoutingData(db);
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "test token",
    });
    await replaceHubTokenGroupPreferences(db, {
      ownerUserId: "routing-test-user",
      tokenId: token.id,
      preferences: [{ groupId: setup.secondGroupId, priority: 0, weight: 100 }],
    });

    const route = await planHubRoute(db, {
      tokenId: token.id,
      model: "routing-test-gpt-5-5",
    });
    expect(route.candidates[0]?.groupId).toBe(setup.secondGroupId);
    expect(route.candidates.map((candidate) => candidate.groupId)).toContain(
      setup.firstGroupId,
    );
    expect(route.candidates.length).toBeLessThanOrEqual(10);

    const preferences = await listHubTokenGroupPreferences(db, {
      ownerUserId: "routing-test-user",
      tokenId: token.id,
    });
    expect(preferences[0]?.groupId).toBe(setup.secondGroupId);
  });

  test("usage charge is balanced and idempotent", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 10_000_000n,
      idempotencyKey: "routing-test-credit-1",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "billing token",
    });
    const request = await createHubRequest(db, {
      ownerUserId: "routing-test-user",
      tokenId: token.id,
      canonicalModelId: setup.modelId,
      routePlan: [
        {
          groupModelId: setup.firstGroupModelId,
          relayChannelBindingId: setup.firstBindingId,
          externalChannelId: setup.firstChannelId,
          upstreamModel: "routing-test-gpt-5-5",
          configVersion: 1,
        },
      ],
    });

    const first = await postHubUsageCharge(db, {
      ownerId: "routing-test-user",
      tokenId: token.id,
      requestId: request.id,
      sourceSystem: "routing-test",
      sourceEventId: request.id,
      modelId: setup.modelId,
      groupId: setup.firstGroupId,
      finalGroupModelId: setup.firstGroupModelId,
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    });
    const repeated = await postHubUsageCharge(db, {
      ownerId: "routing-test-user",
      tokenId: token.id,
      requestId: request.id,
      sourceSystem: "routing-test",
      sourceEventId: request.id,
      modelId: setup.modelId,
      groupId: setup.firstGroupId,
      finalGroupModelId: setup.firstGroupModelId,
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    });

    expect(first.duplicate).toBe(false);
    expect(repeated.duplicate).toBe(true);
    expect(first.usage.userAmountMicros).toBe(3_200_000n);
    expect(repeated.usage.id).toBe(first.usage.id);

    await finishHubRequest(db, {
      requestId: request.id,
      status: "succeeded",
      finalGroupModelId: setup.firstGroupModelId,
    });
    const activity = await listHubUserRequestActivity(db, {
      ownerUserId: "routing-test-user",
    });
    expect(activity[0]).toMatchObject({
      requestId: request.id,
      status: "succeeded",
      tokenName: "billing token",
      modelName: "Routing Test GPT-5.5",
      providerName: "Routing Test Provider 0",
      groupName: "First",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      chargedAmountMicros: "3200000",
      currency: "USD",
    });
  });

  test("reserves the maximum route cost and captures only actual usage", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 10_000_000n,
      idempotencyKey: "routing-test-credit-authorization",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "authorization token",
    });
    const request = await createHubRequest(db, {
      ownerUserId: "routing-test-user",
      tokenId: token.id,
      canonicalModelId: setup.modelId,
      routePlan: [
        {
          groupModelId: setup.firstGroupModelId,
          relayChannelBindingId: setup.firstBindingId,
          externalChannelId: setup.firstChannelId,
          upstreamModel: "routing-test-gpt-5-5",
          configVersion: 1,
        },
      ],
    });
    const reservedAmount = await quoteHubUsageAuthorization(db, {
      modelId: setup.modelId,
      groupIds: [setup.firstGroupId, setup.secondGroupId],
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(reservedAmount).toBe(4_800_000n);

    const authorized = await authorizeHubUsage(db, {
      ownerId: "routing-test-user",
      requestId: request.id,
      amountMicros: reservedAmount,
    });
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(5_200_000n);

    const charged = await postHubUsageCharge(db, {
      ownerId: "routing-test-user",
      tokenId: token.id,
      requestId: request.id,
      sourceSystem: "routing-test-authorization",
      sourceEventId: request.id,
      modelId: setup.modelId,
      groupId: setup.firstGroupId,
      finalGroupModelId: setup.firstGroupModelId,
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      authorizationId: authorized.authorization.id,
    });
    expect(charged.usage.userAmountMicros).toBe(3_200_000n);
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(6_800_000n);

    const [authorization] = await db
      .select()
      .from(hubBillingAuthorizations)
      .where(eq(hubBillingAuthorizations.id, authorized.authorization.id));
    expect(authorization?.status).toBe("captured");
    expect(authorization?.capturedAmountMicros).toBe(3_200_000n);
    expect(authorization?.settlementJournalId).not.toBeNull();
    const settlementLines = await db
      .select({
        direction: hubLedgerLines.direction,
        amountMicros: hubLedgerLines.amountMicros,
      })
      .from(hubLedgerLines)
      .where(
        eq(
          hubLedgerLines.journalId,
          authorization?.settlementJournalId ??
            "00000000-0000-0000-0000-000000000000",
        ),
      );
    expect(sumLedgerDirection(settlementLines, "debit")).toBe(
      sumLedgerDirection(settlementLines, "credit"),
    );
  });

  test("releases failed and expired usage authorizations", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 2_000_000n,
      idempotencyKey: "routing-test-credit-release",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "release token",
    });
    const firstRequest = await createTestRequest(db, token.id, setup);
    const first = await authorizeHubUsage(db, {
      ownerId: "routing-test-user",
      requestId: firstRequest.id,
      amountMicros: 600_000n,
    });
    await releaseHubUsageAuthorization(db, {
      authorizationId: first.authorization.id,
    });
    const repeated = await releaseHubUsageAuthorization(db, {
      authorizationId: first.authorization.id,
    });
    expect(repeated.duplicate).toBe(true);

    const secondRequest = await createTestRequest(db, token.id, setup);
    await authorizeHubUsage(db, {
      ownerId: "routing-test-user",
      requestId: secondRequest.id,
      amountMicros: 700_000n,
      expiresAt: new Date(Date.now() - 1_000),
    });
    await finishHubRequest(db, {
      requestId: secondRequest.id,
      status: "failed",
    });
    const expired = await releaseExpiredHubUsageAuthorizations(db);
    expect(expired.released).toBe(1);
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(2_000_000n);
    const statuses = await db
      .select({ status: hubBillingAuthorizations.status })
      .from(hubBillingAuthorizations)
      .orderBy(hubBillingAuthorizations.createdAt);
    expect(statuses.map((row) => row.status).sort()).toEqual([
      "expired",
      "released",
    ]);
  });

  test("serializes concurrent authorizations so balance cannot be overspent", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 5_000_000n,
      idempotencyKey: "routing-test-credit-concurrency",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "concurrency token",
    });
    const requests = await Promise.all([
      createTestRequest(db, token.id, setup),
      createTestRequest(db, token.id, setup),
    ]);
    const results = await Promise.allSettled(
      requests.map((request) =>
        authorizeHubUsage(db, {
          ownerId: "routing-test-user",
          requestId: request.id,
          amountMicros: 4_000_000n,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection?.status === "rejected" && rejection.reason).toBeInstanceOf(
      HubInsufficientBalanceError,
    );
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(1_000_000n);
  });

  test("captures a concurrent duplicate usage event only once", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 10_000_000n,
      idempotencyKey: "routing-test-credit-concurrent-capture",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "concurrent capture token",
    });
    const request = await createTestRequest(db, token.id, setup);
    const authorized = await authorizeHubUsage(db, {
      ownerId: "routing-test-user",
      requestId: request.id,
      amountMicros: 4_800_000n,
    });
    const charge = () =>
      postHubUsageCharge(db, {
        ownerId: "routing-test-user",
        tokenId: token.id,
        requestId: request.id,
        sourceSystem: "routing-test-concurrent-capture",
        sourceEventId: request.id,
        modelId: setup.modelId,
        groupId: setup.firstGroupId,
        finalGroupModelId: setup.firstGroupModelId,
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
        authorizationId: authorized.authorization.id,
      });
    const results = await Promise.all([charge(), charge()]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(6_800_000n);
  });

  test("does not expire an authorization after a successful upstream attempt", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 2_000_000n,
      idempotencyKey: "routing-test-credit-success-reserve",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "successful reserve token",
    });
    const request = await createTestRequest(db, token.id, setup);
    const authorized = await authorizeHubUsage(db, {
      ownerId: "routing-test-user",
      requestId: request.id,
      amountMicros: 700_000n,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const now = new Date();
    await db.insert(hubRequestAttempts).values({
      requestId: request.id,
      attemptNo: 1,
      groupModelId: setup.firstGroupModelId,
      relayChannelBindingId: setup.firstBindingId,
      externalChannelId: setup.firstChannelId,
      configVersion: 1,
      outcome: "success",
      startedAt: now,
      completedAt: now,
    });

    const expired = await releaseExpiredHubUsageAuthorizations(db);
    expect(expired.released).toBe(0);
    const [authorization] = await db
      .select({ status: hubBillingAuthorizations.status })
      .from(hubBillingAuthorizations)
      .where(eq(hubBillingAuthorizations.id, authorized.authorization.id));
    expect(authorization?.status).toBe("reserved");
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(1_300_000n);
  });

  test("captures a staged settlement after the gateway process is gone", async () => {
    const setup = await seedRoutingData(db);
    await postHubManualCredit(db, {
      ownerId: "routing-test-user",
      amountMicros: 10_000_000n,
      idempotencyKey: "routing-test-credit-pending-settlement",
    });
    const token = await createHubApiToken(db, {
      ownerUserId: "routing-test-user",
      name: "pending settlement token",
    });
    const request = await createTestRequest(db, token.id, setup);
    const authorized = await authorizeHubUsage(db, {
      ownerId: "routing-test-user",
      requestId: request.id,
      amountMicros: 4_800_000n,
    });
    const now = new Date();
    await stageHubUsageSettlement(db, {
      authorizationId: authorized.authorization.id,
      payload: {
        ownerId: "routing-test-user",
        tokenId: token.id,
        requestId: request.id,
        sourceSystem: "llmhub-gateway",
        sourceEventId: request.id,
        modelId: setup.modelId,
        groupId: setup.firstGroupId,
        finalGroupModelId: setup.firstGroupModelId,
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
        externalRequestId: "pending-settlement-upstream",
      },
      attempt: {
        attemptNo: 1,
        groupModelId: setup.firstGroupModelId,
        relayChannelBindingId: setup.firstBindingId,
        externalChannelId: setup.firstChannelId,
        configVersion: 1,
        upstreamRequestId: "pending-settlement-upstream",
        startedAt: now,
        completedAt: now,
      },
    });

    const captured = await capturePendingHubUsageSettlements(db);
    expect(captured).toEqual({ captured: 1, failed: 0, processed: 1 });
    expect(
      await getHubLedgerBalance(db, { ownerId: "routing-test-user" }),
    ).toBe(6_800_000n);
    const [authorization] = await db
      .select({ status: hubBillingAuthorizations.status })
      .from(hubBillingAuthorizations)
      .where(eq(hubBillingAuthorizations.id, authorized.authorization.id));
    expect(authorization?.status).toBe("captured");
    const [completedRequest] = await db
      .select({ status: hubRequests.status })
      .from(hubRequests)
      .where(eq(hubRequests.id, request.id));
    expect(completedRequest?.status).toBe("succeeded");
  });
});

async function createTestRequest(
  db: ReturnType<typeof createMarketplaceDb>["db"],
  tokenId: string,
  setup: Awaited<ReturnType<typeof seedRoutingData>>,
) {
  return createHubRequest(db, {
    ownerUserId: "routing-test-user",
    tokenId,
    canonicalModelId: setup.modelId,
    routePlan: [
      {
        groupModelId: setup.firstGroupModelId,
        relayChannelBindingId: setup.firstBindingId,
        externalChannelId: setup.firstChannelId,
        upstreamModel: "routing-test-gpt-5-5",
        configVersion: 1,
      },
    ],
  });
}

function sumLedgerDirection(
  lines: Array<{ direction: "debit" | "credit"; amountMicros: bigint }>,
  direction: "debit" | "credit",
) {
  return lines
    .filter((line) => line.direction === direction)
    .reduce((total, line) => total + line.amountMicros, 0n);
}

async function seedRoutingData(
  db: ReturnType<typeof createMarketplaceDb>["db"],
) {
  const model = await db
    .insert(hubModels)
    .values({
      slug: "routing-test-gpt-5-5",
      vendor: "OpenAI",
      family: "GPT",
      canonicalName: "routing-test-gpt-5-5",
      displayName: "Routing Test GPT-5.5",
      shortName: "Routing Test GPT-5.5",
      capabilities: ["chat_completions"],
    })
    .returning({ id: hubModels.id });
  const modelId = model[0]?.id;
  if (!modelId) throw new Error("Failed to seed routing model");
  const baseUrlCiphertext = "routing-test-base-url";
  const apiKeyCiphertext = "routing-test-api-key";
  const created: string[] = [];
  for (const [index, name] of (["First", "Second"] as const).entries()) {
    const group = await createHubGroup(db, {
      ownerWorkspaceId: `routing-test-workspace-${index}`,
      providerSlug: `routing-test-provider-${index}`,
      providerName: `Routing Test Provider ${index}`,
      name,
      baseUrlCiphertext,
      baseUrlHostHash: `routing-test-host-${index}`,
      apiKeyCiphertext,
      keyFingerprint: `routing-test-fingerprint-${index}`,
      apiKeyLastFour: "test",
      multiplierBps: 8_000,
      discoveredModels: ["routing-test-gpt-5-5"],
    });
    created.push(group.id);
    const groupModel = await db
      .select({ id: hubGroupModels.id })
      .from(hubGroupModels)
      .where(eq(hubGroupModels.groupId, group.id))
      .limit(1);
    await db
      .update(hubGroupModels)
      .set({
        modelId,
        discoveryStatus: "active",
        trafficEnabled: true,
        probeEnabled: true,
      })
      .where(eq(hubGroupModels.groupId, group.id));
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready", listingStatus: "listed" })
      .where(eq(hubProviderGroups.id, group.id));
    const [binding] = await db
      .insert(hubRelayChannelBindings)
      .values({
        groupId: group.id,
        routeKey: `routing-test-route-${index}`,
        externalChannelId: `routing-test-channel-${index}`,
        appliedConfigVersion: 1,
        configChecksum: `routing-test-checksum-${index}`,
      })
      .returning({ id: hubRelayChannelBindings.id });
    if (!groupModel[0] || !binding) {
      throw new Error("Failed to seed routing group model");
    }
    await db
      .update(hubGroupModels)
      .set({ relayChannelBindingId: binding.id, updatedAt: new Date() })
      .where(eq(hubGroupModels.id, groupModel[0].id));
  }
  await db.insert(hubModelPriceVersions).values({
    modelId,
    currency: "USD",
    billingMode: "token",
    source: "routing-test",
    changeReason: "routing-test-price",
    effectiveFrom: new Date(Date.now() - 1_000),
  });
  const [price] = await db
    .select({ id: hubModelPriceVersions.id })
    .from(hubModelPriceVersions)
    .where(eq(hubModelPriceVersions.modelId, modelId))
    .orderBy(hubModelPriceVersions.effectiveFrom);
  if (!price) throw new Error("Failed to seed routing price");
  await db.insert(hubModelPriceComponents).values([
    {
      priceVersionId: price.id,
      component: "input_text",
      unit: "million_tokens",
      amountMicros: 2_000_000n,
    },
    {
      priceVersionId: price.id,
      component: "output_text",
      unit: "million_tokens",
      amountMicros: 4_000_000n,
    },
  ]);
  const groupModels = await db
    .select({ id: hubGroupModels.id, groupId: hubGroupModels.groupId })
    .from(hubGroupModels)
    .where(inArray(hubGroupModels.groupId, created));
  const first = groupModels.find((item) => item.groupId === created[0]);
  if (!first || !created[0] || !created[1])
    throw new Error("Failed to seed routing IDs");
  const firstBinding = await db
    .select({
      id: hubRelayChannelBindings.id,
      externalChannelId: hubRelayChannelBindings.externalChannelId,
    })
    .from(hubRelayChannelBindings)
    .where(eq(hubRelayChannelBindings.groupId, created[0]));
  if (!firstBinding[0]) throw new Error("Failed to seed first route binding");
  return {
    modelId,
    firstGroupId: created[0],
    secondGroupId: created[1],
    firstGroupModelId: first.id,
    firstBindingId: firstBinding[0].id,
    firstChannelId: firstBinding[0].externalChannelId,
  };
}

async function groupModelIds(
  db: ReturnType<typeof createMarketplaceDb>["db"],
  groupIds: string[],
) {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({ id: hubGroupModels.id })
    .from(hubGroupModels)
    .where(inArray(hubGroupModels.groupId, groupIds));
  return rows.map((row) => row.id);
}
