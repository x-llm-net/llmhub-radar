import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { seedModelCatalog } from "./catalog";
import { createMarketplaceDb } from "./db";
import {
  getMarketplaceOverview,
  getModelLeaderboard,
  getProviderRankings,
  refreshProviderModelStats,
} from "./repository";
import { cleanupExpiredHistory } from "./retention";
import {
  healthBuckets3h,
  models,
  probeChecks,
  probeTargets,
  providerModels,
  providerModelStats,
  providers,
  sponsorships,
} from "./schema";
import { BUCKET_COUNT, BUCKET_MS, floorToBucket } from "./scoring";

const configuredTestDatabaseUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const databaseUrl =
  configuredTestDatabaseUrl &&
  /(^|[_-])test([_-]|$)/i.test(
    new URL(configuredTestDatabaseUrl).pathname.split("/").at(-1) ?? "",
  )
    ? configuredTestDatabaseUrl
    : undefined;
const describeDatabase = databaseUrl ? describe : describe.skip;

if (configuredTestDatabaseUrl && !databaseUrl) {
  console.warn(
    "Skipping Marketplace integration tests: use a dedicated database whose name contains 'test'.",
  );
}

describeDatabase("marketplace PostgreSQL integration", () => {
  if (!databaseUrl) return;

  const { client, db } = createMarketplaceDb(databaseUrl);
  const asOf = new Date("2026-07-23T12:34:56.000Z");

  beforeEach(async () => {
    await db.delete(sponsorships);
    await db.delete(providerModelStats);
    await db.delete(healthBuckets3h);
    await db.delete(probeChecks);
    await db.delete(probeTargets);
    await db.delete(providerModels);
    await db.delete(providers);
    await seedModelCatalog(db);
  });

  afterAll(async () => {
    await client.close();
  });

  test("runs retention cleanup against PostgreSQL", async () => {
    const result = await cleanupExpiredHistory(db, {
      now: asOf,
      batchSize: 10,
    });

    expect(result.deletedChecks).toBe(0);
    expect(result.deletedBuckets).toBe(0);
  });

  test("publishes a measured model in natural and sponsored results", async () => {
    const [provider] = await db
      .insert(providers)
      .values({
        slug: "integration-provider",
        name: "Integration Provider",
        description: "Integration provider profile",
        websiteUrl: "https://integration.example.com",
        status: "published",
      })
      .returning({ id: providers.id });
    const [model] = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.slug, "gpt-5-4"))
      .limit(1);

    expect(provider).toBeDefined();
    expect(model).toBeDefined();
    if (!provider || !model) return;

    const createdAt = new Date(asOf.getTime() - 8 * 24 * 60 * 60 * 1000);
    const [providerModel] = await db
      .insert(providerModels)
      .values({
        providerId: provider.id,
        modelId: model.id,
        providerModelName: "gpt-5.4",
        status: "observing",
        createdAt,
      })
      .returning({ id: providerModels.id });
    expect(providerModel).toBeDefined();
    if (!providerModel) return;

    const [target] = await db
      .insert(probeTargets)
      .values({
        providerModelId: providerModel.id,
        name: "default",
        endpointUrlCiphertext: "integration-endpoint-ciphertext",
        apiKeyCiphertext: "integration-ciphertext",
        apiKeyFingerprint: "integration-fingerprint",
        apiKeyLastFour: "test",
        createdAt,
      })
      .returning({ id: probeTargets.id });
    expect(target).toBeDefined();
    if (!target) return;

    const windowEnd = floorToBucket(asOf);
    await db.insert(healthBuckets3h).values(
      Array.from({ length: BUCKET_COUNT }, (_, index) => {
        const lastBucket = index === BUCKET_COUNT - 1;
        return {
          providerModelId: providerModel.id,
          bucketStart: new Date(
            windowEnd.getTime() - (BUCKET_COUNT - index) * BUCKET_MS,
          ),
          expectedCount: 18,
          attemptedCount: 18,
          successCount: lastBucket ? 17 : 18,
          providerFailureCount: lastBucket ? 1 : 0,
          availabilityBps: lastBucket ? 9_444 : 10_000,
          coverageBps: 10_000,
          lastCheckAt: new Date(
            windowEnd.getTime() -
              (BUCKET_COUNT - index) * BUCKET_MS +
              17 * 10 * 60 * 1000,
          ),
        };
      }),
    );
    await db.insert(probeChecks).values({
      targetId: target.id,
      providerModelId: providerModel.id,
      scheduledAt: new Date(asOf.getTime() - 5 * 60 * 1000),
      startedAt: new Date(asOf.getTime() - 5 * 60 * 1000),
      finishedAt: new Date(asOf.getTime() - 5 * 60 * 1000 + 1_000),
      outcome: "success",
      firstTokenMs: 800,
    });

    const stats = await refreshProviderModelStats(db, providerModel.id, asOf);
    expect(stats.eligible).toBe(true);
    expect(stats.grade).toBe("S");
    expect(stats.availabilityBps).toBe(9_990);
    expect(stats.lastCheckAt).toEqual(new Date(asOf.getTime() - 5 * 60 * 1000));

    await db.insert(sponsorships).values({
      providerModelId: providerModel.id,
      slot: 1,
      status: "active",
      startsAt: new Date(asOf.getTime() - 60 * 60 * 1000),
      endsAt: new Date(asOf.getTime() + 60 * 60 * 1000),
    });

    const [observingProvider] = await db
      .insert(providers)
      .values({
        slug: "observing-provider",
        name: "Observing Provider",
        status: "published",
      })
      .returning({ id: providers.id });
    expect(observingProvider).toBeDefined();
    if (!observingProvider) return;

    const [observingModel] = await db
      .insert(providerModels)
      .values({
        providerId: observingProvider.id,
        modelId: model.id,
        providerModelName: "gpt-5.4",
        status: "observing",
        createdAt,
      })
      .returning({ id: providerModels.id });
    expect(observingModel).toBeDefined();
    if (!observingModel) return;

    await db.insert(healthBuckets3h).values({
      providerModelId: observingModel.id,
      bucketStart: new Date(windowEnd.getTime() - BUCKET_MS),
      expectedCount: 18,
      attemptedCount: 18,
      successCount: 17,
      providerFailureCount: 1,
      availabilityBps: 9_444,
      coverageBps: 10_000,
      lastCheckAt: new Date(asOf.getTime() - 20 * 60 * 1000),
    });
    await db.insert(providerModelStats).values({
      providerModelId: observingModel.id,
      windowStart: new Date(windowEnd.getTime() - BUCKET_COUNT * BUCKET_MS),
      windowEnd,
      expectedCount: 900,
      successCount: 890,
      providerFailureCount: 10,
      sampleCount: 900,
      availabilityBps: 9_889,
      coverageBps: 10_000,
      currentStatus: "normal",
      eligible: false,
      eligibilityReason: "insufficient_bucket_coverage",
      validBucketCount: 50,
      lastCheckAt: new Date(asOf.getTime() - 20 * 60 * 1000),
      updatedAt: asOf,
    });

    const leaderboard = await getModelLeaderboard(db, "gpt-5-4", { asOf });
    expect(leaderboard?.ranking).toHaveLength(1);
    expect(leaderboard?.ranking[0]?.naturalRank).toBe(1);
    expect(leaderboard?.ranking[0]?.trend).toHaveLength(56);
    expect(leaderboard?.sponsored).toHaveLength(1);
    expect(leaderboard?.sponsored[0]?.naturalRank).toBe(1);
    expect(leaderboard?.observing).toHaveLength(1);
    expect(leaderboard?.observing[0]?.provider.slug).toBe("observing-provider");
    expect(leaderboard?.observing[0]?.availabilityBps).toBe(9_889);
    expect(leaderboard?.observing[0]?.validBucketCount).toBe(50);
    expect(leaderboard?.observing[0]?.trend).toHaveLength(56);
    expect(leaderboard?.generatedAt).toBe(
      new Date(asOf.getTime() - 5 * 60 * 1000).toISOString(),
    );

    const providerRankings = await getProviderRankings(
      db,
      "integration-provider",
      { asOf },
    );
    expect(providerRankings?.models).toHaveLength(1);
    expect(providerRankings?.provider.description).toBe(
      "Integration provider profile",
    );
    expect(providerRankings?.provider.websiteUrl).toBe(
      "https://integration.example.com",
    );
    expect(providerRankings?.models[0]?.ranking?.naturalRank).toBe(1);
    expect(providerRankings?.models[0]?.ranking?.coverageBps).toBe(10_000);

    const overview = await getMarketplaceOverview(db);
    expect(overview.providerCount).toBe(2);
    expect(overview.latestStatsAt).toBe(
      new Date(asOf.getTime() - 5 * 60 * 1000).toISOString(),
    );

    await db
      .update(providerModelStats)
      .set({ lastCheckAt: new Date(asOf.getTime() - 31 * 60 * 1000) })
      .where(eq(providerModelStats.providerModelId, providerModel.id));
    await db
      .update(providerModelStats)
      .set({ lastCheckAt: new Date(asOf.getTime() - 31 * 60 * 1000) })
      .where(eq(providerModelStats.providerModelId, observingModel.id));

    const staleLeaderboard = await getModelLeaderboard(db, "gpt-5-4", {
      asOf,
    });
    expect(staleLeaderboard?.ranking).toHaveLength(0);
    expect(staleLeaderboard?.sponsored).toHaveLength(0);
    expect(staleLeaderboard?.observing).toHaveLength(0);
  });

  test("caps a tied natural leaderboard at ten providers", async () => {
    const [model] = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.slug, "gpt-5-4"))
      .limit(1);
    expect(model).toBeDefined();
    if (!model) return;

    const providerRows = await db
      .insert(providers)
      .values(
        Array.from({ length: 11 }, (_, index) => ({
          slug: "tied-provider-" + (index + 1),
          name: "Tied Provider " + (index + 1),
          status: "published" as const,
        })),
      )
      .returning({ id: providers.id });
    const listingRows = await db
      .insert(providerModels)
      .values(
        providerRows.map((provider) => ({
          providerId: provider.id,
          modelId: model.id,
          providerModelName: "gpt-5.4",
          status: "ranked" as const,
          createdAt: new Date(asOf.getTime() - 8 * 24 * 60 * 60 * 1000),
        })),
      )
      .returning({ id: providerModels.id });
    const windowEnd = floorToBucket(asOf);
    await db.insert(providerModelStats).values(
      listingRows.map((listing) => ({
        providerModelId: listing.id,
        windowStart: new Date(windowEnd.getTime() - BUCKET_COUNT * BUCKET_MS),
        windowEnd,
        expectedCount: 900,
        successCount: 891,
        providerFailureCount: 9,
        sampleCount: 900,
        availabilityBps: 9_900,
        coverageBps: 10_000,
        grade: "S" as const,
        currentStatus: "normal" as const,
        eligible: true,
        validBucketCount: 56,
        lastCheckAt: new Date(asOf.getTime() - 5 * 60 * 1000),
        updatedAt: asOf,
      })),
    );

    const leaderboard = await getModelLeaderboard(db, "gpt-5-4", { asOf });
    expect(leaderboard?.ranking).toHaveLength(10);
    expect(leaderboard?.ranking.every((row) => row.naturalRank === 1)).toBe(
      true,
    );

    const providerRankings = await getProviderRankings(db, "tied-provider-11", {
      asOf,
    });
    expect(providerRankings?.models[0]?.ranking?.naturalRank).toBe(1);
  });
});
