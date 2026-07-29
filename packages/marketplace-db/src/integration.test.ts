import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { eq, inArray } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import { syncLegacyRadar } from "./legacy-radar-sync";
import {
  getMarketplaceOverview,
  getModelLeaderboard,
  getProviderRankings,
  listPublicMarketplaceModels,
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
    await db.delete(models);
    await db.insert(models).values({
      slug: "gpt-5-4",
      vendor: "OpenAI",
      family: "GPT",
      displayName: "GPT 5.4",
      shortName: "GPT 5.4",
      aliases: ["gpt-5.4", "gpt-5-4"],
    });
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

  test("publishes only models backed by active scoring targets", async () => {
    expect(await listPublicMarketplaceModels(db)).toHaveLength(0);

    const [model] = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.slug, "gpt-5-4"))
      .limit(1);
    const providerRows = await db
      .insert(providers)
      .values([
        {
          slug: "catalog-provider-a",
          name: "Catalog Provider A",
          status: "published",
        },
        {
          slug: "catalog-provider-b",
          name: "Catalog Provider B",
          status: "published",
        },
      ])
      .returning({ id: providers.id });
    expect(model).toBeDefined();
    if (!model || providerRows.length !== 2) return;

    const listings = await db
      .insert(providerModels)
      .values(
        providerRows.map((provider) => ({
          providerId: provider.id,
          modelId: model.id,
          providerModelName: "gpt-5.4",
          status: "observing" as const,
        })),
      )
      .returning({ id: providerModels.id });
    const catalogTargets = await db
      .insert(probeTargets)
      .values(
        listings.map((listing, index) => ({
          providerModelId: listing.id,
          name: `catalog-target-${index}`,
          source: "legacy_radar" as const,
          sourceRef: `catalog-target-${index}`,
          enabled: true,
          isScoring: true,
        })),
      )
      .returning({ id: probeTargets.id });

    expect(
      (await listPublicMarketplaceModels(db)).map((row) => row.slug),
    ).toEqual(["gpt-5-4"]);

    await db
      .update(probeTargets)
      .set({ enabled: false })
      .where(
        inArray(
          probeTargets.id,
          catalogTargets.map((target) => target.id),
        ),
      );
    expect(await listPublicMarketplaceModels(db)).toHaveLength(0);
    await db
      .update(probeTargets)
      .set({ enabled: true })
      .where(
        inArray(
          probeTargets.id,
          catalogTargets.map((target) => target.id),
        ),
      );

    await db
      .update(providerModels)
      .set({ status: "retired" })
      .where(eq(providerModels.id, listings[0]?.id ?? ""));
    expect(await listPublicMarketplaceModels(db)).toHaveLength(1);

    await db
      .update(providerModels)
      .set({ status: "retired" })
      .where(eq(providerModels.id, listings[1]?.id ?? ""));
    expect(await listPublicMarketplaceModels(db)).toHaveLength(0);

    await db
      .update(models)
      .set({ visibility: "show" })
      .where(eq(models.id, model.id));
    expect(await listPublicMarketplaceModels(db)).toHaveLength(1);

    await db
      .update(models)
      .set({ visibility: "hide" })
      .where(eq(models.id, model.id));
    expect(await listPublicMarketplaceModels(db)).toHaveLength(0);
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
      successCount: 2,
      providerFailureCount: 1,
      sampleCount: 3,
      availabilityBps: 6_667,
      coverageBps: 33,
      currentStatus: "normal",
      eligible: false,
      eligibilityReason: "insufficient_samples",
      validBucketCount: 1,
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
    expect(leaderboard?.observing[0]?.availabilityBps).toBe(6_667);
    expect(leaderboard?.observing[0]?.sampleCount).toBe(3);
    expect(leaderboard?.observing[0]?.eligibilityReason).toBe(
      "insufficient_samples",
    );
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

  test("discovers public legacy providers and creates unknown models", async () => {
    const windowEnd = floorToBucket(asOf);
    const bucketStart = new Date(windowEnd.getTime() - BUCKET_MS);
    const runTimes = [5, 15, 25, 35].map(
      (minutes) => new Date(asOf.getTime() - minutes * 60 * 1000),
    );
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("statusPage.listPublicRadar")) {
        return Response.json([
          {
            result: {
              data: {
                json: {
                  items: [{ page: { slug: "fresh-public-provider" } }],
                  totalSize: 1,
                  limit: 24,
                  offset: 0,
                },
              },
            },
          },
        ]);
      }
      if (url.includes("statusPage.get")) {
        return Response.json([
          {
            result: {
              data: {
                json: {
                  title: "Fresh Public Provider",
                  description: "Imported from the public directory",
                  icon: null,
                  slug: "fresh-public-provider",
                  homepageUrl: "https://fresh.example.com",
                  createdAt: "2026-07-20T00:00:00.000Z",
                  updatedAt: "2026-07-23T12:00:00.000Z",
                  radar: {
                    targets: [
                      {
                        id: 101,
                        displayName: "default",
                        serviceGroupName: "default",
                        modelName: "llama-3.1-405b",
                        intervalSeconds: 600,
                        currentStatus: "operational",
                        stabilityBuckets7d: [
                          {
                            from: bucketStart.toISOString(),
                            to: windowEnd.toISOString(),
                            ok: 4,
                            degraded: 0,
                            error: 0,
                            availability: 100,
                          },
                        ],
                        recentRuns: runTimes.map((startedAt, index) => ({
                          id: index + 1,
                          startedAt: startedAt.toISOString(),
                          success: true,
                          httpStatus: 200,
                          errorType: null,
                          firstTokenMs: 900,
                          totalLatencyMs: 1_200,
                        })),
                      },
                    ],
                  },
                },
              },
            },
          },
        ]);
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await syncLegacyRadar({
      db,
      baseUrl: "https://legacy.example.com",
      fetchFn,
      now: asOf,
    });

    expect(result.providers).toBe(1);
    expect(result.listings).toBe(1);
    expect(result.scoringTargets).toBe(1);
    expect(result.skippedModels).toEqual([]);

    const [createdModel] = await db
      .select()
      .from(models)
      .where(eq(models.slug, "llama-3-1-405b"))
      .limit(1);
    expect(createdModel?.displayName).toBe("Llama 3.1 405B");
    expect(createdModel?.vendor).toBe("Meta");

    const leaderboard = await getModelLeaderboard(db, "llama-3-1-405b", {
      asOf,
    });
    expect(leaderboard?.ranking).toHaveLength(1);
    expect(leaderboard?.ranking[0]?.provider.slug).toBe(
      "fresh-public-provider",
    );
    expect(leaderboard?.ranking[0]?.sampleCount).toBe(4);
    expect(leaderboard?.observing).toHaveLength(0);

    const [providerModel] = await db
      .select({ id: providerModels.id })
      .from(providerModels)
      .limit(1);
    expect(providerModel).toBeDefined();
    if (!providerModel) return;

    const staleBucketStart = new Date(
      windowEnd.getTime() - BUCKET_COUNT * BUCKET_MS,
    );
    await db.insert(healthBuckets3h).values({
      providerModelId: providerModel.id,
      bucketStart: staleBucketStart,
      expectedCount: 18,
      attemptedCount: 4,
      successCount: 4,
      providerFailureCount: 0,
      configurationErrorCount: 0,
      observerErrorCount: 0,
      slowSuccessCount: 0,
      availabilityBps: 10_000,
      coverageBps: 2_222,
      lastCheckAt: new Date(staleBucketStart.getTime() + BUCKET_MS),
      updatedAt: asOf,
    });

    const resyncResult = await syncLegacyRadar({
      db,
      baseUrl: "https://legacy.example.com",
      fetchFn,
      now: asOf,
    });
    expect(resyncResult.staleBucketsDeleted).toBe(1);

    const resyncedLeaderboard = await getModelLeaderboard(
      db,
      "llama-3-1-405b",
      { asOf },
    );
    const trend = resyncedLeaderboard?.ranking[0]?.trend ?? [];
    expect(trend[0]?.sampleCount).toBe(0);
    expect(trend.at(-1)?.sampleCount).toBe(4);
  });

  test("orders tied availability by internal ranking score without exposing it", async () => {
    const [model] = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.slug, "gpt-5-4"))
      .limit(1);
    expect(model).toBeDefined();
    if (!model) return;

    const providerRows = await db
      .insert(providers)
      .values([
        {
          slug: "rank-slow-provider",
          name: "Rank Slow Provider",
          status: "published" as const,
        },
        {
          slug: "rank-fast-provider",
          name: "Rank Fast Provider",
          status: "published" as const,
        },
      ])
      .returning({ id: providers.id, slug: providers.slug });
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
      .returning({
        id: providerModels.id,
        providerId: providerModels.providerId,
      });
    await db.insert(probeTargets).values(
      listingRows.map((listing, index) => ({
        providerModelId: listing.id,
        name: `rank-score-target-${index}`,
        source: "legacy_radar" as const,
        sourceRef: `rank-score-target-${index}`,
        enabled: true,
        isScoring: true,
      })),
    );

    const windowEnd = floorToBucket(asOf);
    const providerSlugById = new Map(
      providerRows.map((provider) => [provider.id, provider.slug]),
    );
    await db.insert(providerModelStats).values(
      listingRows.map((listing) => {
        const fast =
          providerSlugById.get(listing.providerId) === "rank-fast-provider";
        return {
          providerModelId: listing.id,
          windowStart: new Date(windowEnd.getTime() - BUCKET_COUNT * BUCKET_MS),
          windowEnd,
          expectedCount: 900,
          successCount: 891,
          providerFailureCount: 9,
          sampleCount: 700,
          availabilityBps: 9_900,
          coverageBps: 10_000,
          grade: "S" as const,
          currentStatus: "normal" as const,
          eligible: true,
          firstTokenP50Ms: fast ? 900 : 5_000,
          firstTokenP95Ms: fast ? 1_800 : 12_000,
          rankingScoreBps: fast ? 9_785 : 9_000,
          validBucketCount: 56,
          lastCheckAt: new Date(asOf.getTime() - 5 * 60 * 1000),
          updatedAt: asOf,
        };
      }),
    );

    const leaderboard = await getModelLeaderboard(db, "gpt-5-4", { asOf });

    expect(leaderboard?.ranking.map((row) => row.provider.slug)).toEqual([
      "rank-fast-provider",
      "rank-slow-provider",
    ]);
    expect(leaderboard?.ranking.map((row) => row.naturalRank)).toEqual([1, 2]);
    expect(leaderboard?.ranking[0]?.availabilityBps).toBe(9_900);
    expect(leaderboard?.ranking[0]?.firstTokenP50Ms).toBe(900);
    expect(leaderboard?.ranking[0]?.firstTokenP95Ms).toBe(1_800);
    expect(
      Object.prototype.hasOwnProperty.call(
        leaderboard?.ranking[0] ?? {},
        "rankingScoreBps",
      ),
    ).toBe(false);
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
    await db.insert(probeTargets).values(
      listingRows.map((listing, index) => ({
        providerModelId: listing.id,
        name: "tied-target-" + (index + 1),
        source: "legacy_radar" as const,
        sourceRef: "tied-target-" + (index + 1),
        isScoring: true,
      })),
    );
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
