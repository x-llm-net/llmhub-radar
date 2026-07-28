import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  compareMarketplaceModels,
  presentMarketplaceModel,
} from "./model-metadata";
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
import {
  aggregateProbeSamples,
  BUCKET_HOURS,
  BUCKET_MS,
  calculateSevenDayStats,
  DEFAULT_MIN_RANKING_AVAILABILITY_BPS,
  deriveCurrentStatus,
  fillMissingBuckets,
  floorToBucket,
  getCompletedWindow,
  type CurrentStatusValue,
} from "./scoring";

export interface TrendBucket {
  startsAt: string;
  availabilityBps: number | null;
  sampleCount: number;
}

export interface LeaderboardRow {
  providerModelId: string;
  provider: {
    slug: string;
    name: string;
    logoUrl: string | null;
  };
  providerModelName: string;
  purchaseUrl: string | null;
  availabilityBps: number;
  coverageBps: number;
  grade: "S" | "A" | "B" | "C" | "D";
  sampleCount: number;
  validBucketCount: number;
  currentStatus:
    | "unknown"
    | "normal"
    | "degraded"
    | "down"
    | "configuration_error"
    | "stale";
  lastCheckAt: string | null;
  naturalRank: number;
  trend: TrendBucket[];
}

export interface ObservingRow {
  providerModelId: string;
  provider: {
    slug: string;
    name: string;
    logoUrl: string | null;
  };
  providerModelName: string;
  purchaseUrl: string | null;
  availabilityBps: number | null;
  coverageBps: number;
  sampleCount: number;
  currentStatus: CurrentStatusValue;
  lastCheckAt: string | null;
  eligibilityReason: string | null;
  validBucketCount: number;
  trend: TrendBucket[];
}

export interface ModelLeaderboard {
  model: {
    slug: string;
    vendor: string;
    family: string;
    displayName: string;
    shortName: string;
    description: string;
  };
  generatedAt: string | null;
  sponsored: Array<LeaderboardRow & { slot: number }>;
  ranking: LeaderboardRow[];
  observing: ObservingRow[];
}

export interface ProviderRankings {
  provider: {
    slug: string;
    name: string;
    description: string;
    websiteUrl: string | null;
    logoUrl: string | null;
  };
  generatedAt: string | null;
  models: Array<{
    model: ModelLeaderboard["model"];
    generatedAt: string | null;
    ranking: LeaderboardRow | null;
    observing: ObservingRow | null;
  }>;
}

const LEADERBOARD_FRESHNESS_MS = 30 * 60 * 1000;

function expectedChecksPerBucket(intervalSeconds: number) {
  return Math.floor((BUCKET_HOURS * 60 * 60) / intervalSeconds);
}

export async function refreshHealthBucket(
  db: MarketplaceDb,
  providerModelId: string,
  value: Date,
) {
  const bucketStart = floorToBucket(value);
  const bucketEnd = new Date(bucketStart.getTime() + BUCKET_MS);
  const [target] = await db
    .select({
      id: probeTargets.id,
      intervalSeconds: probeTargets.intervalSeconds,
    })
    .from(probeTargets)
    .where(
      and(
        eq(probeTargets.providerModelId, providerModelId),
        eq(probeTargets.enabled, true),
        eq(probeTargets.isScoring, true),
      ),
    )
    .limit(1);

  if (!target) {
    throw new Error(`No active scoring target for ${providerModelId}`);
  }

  const checks = await db
    .select({
      attemptNo: probeChecks.attemptNo,
      outcome: probeChecks.outcome,
      scheduledAt: probeChecks.scheduledAt,
      firstTokenMs: probeChecks.firstTokenMs,
    })
    .from(probeChecks)
    .where(
      and(
        eq(probeChecks.targetId, target.id),
        gte(probeChecks.scheduledAt, bucketStart),
        lt(probeChecks.scheduledAt, bucketEnd),
      ),
    );
  const bucket = aggregateProbeSamples(
    bucketStart,
    expectedChecksPerBucket(target.intervalSeconds),
    checks,
  );

  await db
    .insert(healthBuckets3h)
    .values({
      providerModelId,
      ...bucket,
    })
    .onConflictDoUpdate({
      target: [healthBuckets3h.providerModelId, healthBuckets3h.bucketStart],
      set: {
        expectedCount: bucket.expectedCount,
        attemptedCount: bucket.attemptedCount,
        successCount: bucket.successCount,
        providerFailureCount: bucket.providerFailureCount,
        configurationErrorCount: bucket.configurationErrorCount,
        observerErrorCount: bucket.observerErrorCount,
        slowSuccessCount: bucket.slowSuccessCount,
        availabilityBps: bucket.availabilityBps,
        coverageBps: bucket.coverageBps,
        lastCheckAt: bucket.lastCheckAt,
        updatedAt: new Date(),
      },
    });

  return bucket;
}

export async function refreshProviderModelStats(
  db: MarketplaceDb,
  providerModelId: string,
  asOf = new Date(),
  minRankingAvailabilityBps = DEFAULT_MIN_RANKING_AVAILABILITY_BPS,
) {
  const { windowStart, windowEnd } = getCompletedWindow(asOf);
  const [target] = await db
    .select({
      intervalSeconds: probeTargets.intervalSeconds,
      createdAt: probeTargets.createdAt,
    })
    .from(probeTargets)
    .where(
      and(
        eq(probeTargets.providerModelId, providerModelId),
        eq(probeTargets.enabled, true),
        eq(probeTargets.isScoring, true),
      ),
    )
    .limit(1);
  const [listing] = await db
    .select({ status: providerModels.status })
    .from(providerModels)
    .where(eq(providerModels.id, providerModelId))
    .limit(1);

  if (!target || !listing) {
    throw new Error(`Unknown provider model ${providerModelId}`);
  }

  const storedBuckets = await db
    .select()
    .from(healthBuckets3h)
    .where(
      and(
        eq(healthBuckets3h.providerModelId, providerModelId),
        gte(healthBuckets3h.bucketStart, windowStart),
        lt(healthBuckets3h.bucketStart, windowEnd),
      ),
    );
  const buckets = fillMissingBuckets(
    storedBuckets,
    asOf,
    expectedChecksPerBucket(target.intervalSeconds),
    target.createdAt,
  );
  const latestChecks = await db
    .select({
      attemptNo: probeChecks.attemptNo,
      outcome: probeChecks.outcome,
      scheduledAt: probeChecks.scheduledAt,
      firstTokenMs: probeChecks.firstTokenMs,
    })
    .from(probeChecks)
    .where(
      and(
        eq(probeChecks.providerModelId, providerModelId),
        eq(probeChecks.attemptNo, 0),
      ),
    )
    .orderBy(desc(probeChecks.scheduledAt))
    .limit(3);
  const status = deriveCurrentStatus(latestChecks, asOf);
  const calculatedStats = calculateSevenDayStats(
    buckets,
    asOf,
    status,
    target.createdAt,
    minRankingAvailabilityBps,
  );
  const stats = {
    ...calculatedStats,
    lastCheckAt: latestChecks[0]?.scheduledAt ?? calculatedStats.lastCheckAt,
  };

  await db
    .insert(providerModelStats)
    .values({
      providerModelId,
      ...stats,
      updatedAt: asOf,
    })
    .onConflictDoUpdate({
      target: providerModelStats.providerModelId,
      set: {
        windowStart: stats.windowStart,
        windowEnd: stats.windowEnd,
        expectedCount: stats.expectedCount,
        successCount: stats.successCount,
        providerFailureCount: stats.providerFailureCount,
        sampleCount: stats.sampleCount,
        availabilityBps: stats.availabilityBps,
        coverageBps: stats.coverageBps,
        grade: stats.grade,
        currentStatus: stats.currentStatus,
        eligible: stats.eligible,
        eligibilityReason: stats.eligibilityReason,
        validBucketCount: stats.validBucketCount,
        lastCheckAt: stats.lastCheckAt,
        updatedAt: asOf,
      },
    });

  if (listing.status === "observing" || listing.status === "ranked") {
    await db
      .update(providerModels)
      .set({
        status: stats.eligible ? "ranked" : "observing",
        updatedAt: asOf,
      })
      .where(eq(providerModels.id, providerModelId));
  }

  return stats;
}

type RankedSourceRow = {
  providerModelId: string;
  providerSlug: string;
  providerName: string;
  providerLogoUrl: string | null;
  providerModelName: string;
  purchaseUrl: string | null;
  availabilityBps: number | null;
  coverageBps: number;
  grade: "S" | "A" | "B" | "C" | "D" | null;
  sampleCount: number;
  validBucketCount: number;
  currentStatus: CurrentStatusValue;
  lastCheckAt: Date | null;
};

type ObservingSourceRow = Omit<RankedSourceRow, "grade" | "availabilityBps"> & {
  availabilityBps: number | null;
  eligibilityReason: string | null;
  validBucketCount: number;
};

function assignNaturalRanks(rows: RankedSourceRow[]) {
  let naturalRank = 0;
  let previousScore: number | null = null;

  return rows.map((row) => {
    if (row.availabilityBps !== previousScore) {
      naturalRank += 1;
      previousScore = row.availabilityBps;
    }
    return { row, naturalRank };
  });
}

async function loadTrends(
  db: MarketplaceDb,
  providerModelIds: string[],
  asOf: Date,
) {
  const result = new Map<string, TrendBucket[]>();
  if (providerModelIds.length === 0) return result;

  const { windowStart, windowEnd } = getCompletedWindow(asOf);
  const rows = await db
    .select()
    .from(healthBuckets3h)
    .where(
      and(
        inArray(healthBuckets3h.providerModelId, providerModelIds),
        gte(healthBuckets3h.bucketStart, windowStart),
        lt(healthBuckets3h.bucketStart, windowEnd),
      ),
    )
    .orderBy(asc(healthBuckets3h.bucketStart));

  for (const providerModelId of providerModelIds) {
    const buckets = fillMissingBuckets(
      rows.filter((row) => row.providerModelId === providerModelId),
      asOf,
      0,
    );
    result.set(
      providerModelId,
      buckets.map((bucket) => ({
        startsAt: bucket.bucketStart.toISOString(),
        availabilityBps: bucket.availabilityBps,
        sampleCount: bucket.successCount + bucket.providerFailureCount,
      })),
    );
  }

  return result;
}

function toObservingRow(
  source: ObservingSourceRow,
  trends: Map<string, TrendBucket[]>,
): ObservingRow {
  return {
    providerModelId: source.providerModelId,
    provider: {
      slug: source.providerSlug,
      name: source.providerName,
      logoUrl: source.providerLogoUrl,
    },
    providerModelName: source.providerModelName,
    purchaseUrl: source.purchaseUrl,
    availabilityBps: source.availabilityBps,
    coverageBps: source.coverageBps,
    sampleCount: source.sampleCount,
    currentStatus: source.currentStatus,
    lastCheckAt: source.lastCheckAt?.toISOString() ?? null,
    eligibilityReason: source.eligibilityReason,
    validBucketCount: source.validBucketCount,
    trend: trends.get(source.providerModelId) ?? [],
  };
}

function toLeaderboardRow(
  source: RankedSourceRow,
  naturalRank: number,
  trends: Map<string, TrendBucket[]>,
): LeaderboardRow {
  if (source.availabilityBps === null || source.grade === null) {
    throw new Error("An eligible leaderboard row must have a score and grade");
  }

  return {
    providerModelId: source.providerModelId,
    provider: {
      slug: source.providerSlug,
      name: source.providerName,
      logoUrl: source.providerLogoUrl,
    },
    providerModelName: source.providerModelName,
    purchaseUrl: source.purchaseUrl,
    availabilityBps: source.availabilityBps,
    coverageBps: source.coverageBps,
    grade: source.grade,
    sampleCount: source.sampleCount,
    validBucketCount: source.validBucketCount,
    currentStatus: source.currentStatus,
    lastCheckAt: source.lastCheckAt?.toISOString() ?? null,
    naturalRank,
    trend: trends.get(source.providerModelId) ?? [],
  };
}

export async function getModelLeaderboard(
  db: MarketplaceDb,
  modelSlug: string,
  options: {
    limit?: number;
    asOf?: Date;
    providerSlugs?: string[];
  } = {},
): Promise<ModelLeaderboard | null> {
  const limit = options.limit ?? 10;
  const asOf = options.asOf ?? new Date();
  const freshnessCutoff = new Date(asOf.getTime() - LEADERBOARD_FRESHNESS_MS);
  const [model] = await db
    .select({
      id: models.id,
      slug: models.slug,
      vendor: models.vendor,
      family: models.family,
      displayName: models.displayName,
      shortName: models.shortName,
      description: models.description,
    })
    .from(models)
    .where(and(eq(models.slug, modelSlug), eq(models.enabled, true)))
    .limit(1);

  if (!model) return null;

  const naturalSource: RankedSourceRow[] = await db
    .select({
      providerModelId: providerModels.id,
      providerSlug: providers.slug,
      providerName: providers.name,
      providerLogoUrl: providers.logoUrl,
      providerModelName: providerModels.providerModelName,
      purchaseUrl: providerModels.purchaseUrl,
      availabilityBps: providerModelStats.availabilityBps,
      coverageBps: providerModelStats.coverageBps,
      grade: providerModelStats.grade,
      sampleCount: providerModelStats.sampleCount,
      validBucketCount: providerModelStats.validBucketCount,
      currentStatus: providerModelStats.currentStatus,
      lastCheckAt: providerModelStats.lastCheckAt,
    })
    .from(providerModelStats)
    .innerJoin(
      providerModels,
      eq(providerModels.id, providerModelStats.providerModelId),
    )
    .innerJoin(providers, eq(providers.id, providerModels.providerId))
    .where(
      and(
        eq(providerModels.modelId, model.id),
        eq(providerModels.status, "ranked"),
        eq(providers.status, "published"),
        eq(providerModelStats.eligible, true),
        gte(providerModelStats.lastCheckAt, freshnessCutoff),
        isNotNull(providerModelStats.availabilityBps),
        isNotNull(providerModelStats.grade),
      ),
    )
    .orderBy(desc(providerModelStats.availabilityBps), asc(providers.slug));
  const ranked = assignNaturalRanks(naturalSource);
  const providerSlugSet = options.providerSlugs
    ? new Set(options.providerSlugs)
    : null;
  const selectedNatural = providerSlugSet
    ? ranked.filter((entry) => providerSlugSet.has(entry.row.providerSlug))
    : ranked.slice(0, limit);

  const sponsoredSource = await db
    .select({
      slot: sponsorships.slot,
      row: {
        providerModelId: providerModels.id,
        providerSlug: providers.slug,
        providerName: providers.name,
        providerLogoUrl: providers.logoUrl,
        providerModelName: providerModels.providerModelName,
        purchaseUrl: providerModels.purchaseUrl,
        availabilityBps: providerModelStats.availabilityBps,
        coverageBps: providerModelStats.coverageBps,
        grade: providerModelStats.grade,
        sampleCount: providerModelStats.sampleCount,
        validBucketCount: providerModelStats.validBucketCount,
        currentStatus: providerModelStats.currentStatus,
        lastCheckAt: providerModelStats.lastCheckAt,
      },
    })
    .from(sponsorships)
    .innerJoin(
      providerModels,
      eq(providerModels.id, sponsorships.providerModelId),
    )
    .innerJoin(providers, eq(providers.id, providerModels.providerId))
    .innerJoin(
      providerModelStats,
      eq(providerModelStats.providerModelId, providerModels.id),
    )
    .where(
      and(
        eq(providerModels.modelId, model.id),
        inArray(sponsorships.status, ["scheduled", "active"]),
        lte(sponsorships.startsAt, asOf),
        gt(sponsorships.endsAt, asOf),
        eq(providerModels.status, "ranked"),
        eq(providers.status, "published"),
        eq(providerModelStats.eligible, true),
        gte(providerModelStats.lastCheckAt, freshnessCutoff),
        isNotNull(providerModelStats.availabilityBps),
        isNotNull(providerModelStats.grade),
      ),
    )
    .orderBy(asc(sponsorships.slot), asc(providers.slug));

  const observingSource: ObservingSourceRow[] = await db
    .select({
      providerModelId: providerModels.id,
      providerSlug: providers.slug,
      providerName: providers.name,
      providerLogoUrl: providers.logoUrl,
      providerModelName: providerModels.providerModelName,
      purchaseUrl: providerModels.purchaseUrl,
      availabilityBps: providerModelStats.availabilityBps,
      coverageBps: providerModelStats.coverageBps,
      sampleCount: providerModelStats.sampleCount,
      validBucketCount: providerModelStats.validBucketCount,
      currentStatus: providerModelStats.currentStatus,
      lastCheckAt: providerModelStats.lastCheckAt,
      eligibilityReason: providerModelStats.eligibilityReason,
    })
    .from(providerModelStats)
    .innerJoin(
      providerModels,
      eq(providerModels.id, providerModelStats.providerModelId),
    )
    .innerJoin(providers, eq(providers.id, providerModels.providerId))
    .where(
      and(
        eq(providerModels.modelId, model.id),
        eq(providerModels.status, "observing"),
        eq(providers.status, "published"),
        providerSlugSet
          ? inArray(providers.slug, [...providerSlugSet])
          : gte(providerModelStats.lastCheckAt, freshnessCutoff),
      ),
    );
  observingSource.sort(
    (left, right) =>
      (right.availabilityBps ?? -1) - (left.availabilityBps ?? -1) ||
      right.sampleCount - left.sampleCount ||
      left.providerSlug.localeCompare(right.providerSlug),
  );
  const selectedObserving = providerSlugSet
    ? observingSource.filter((entry) => providerSlugSet.has(entry.providerSlug))
    : observingSource.slice(0, limit);
  const selectedSponsored = providerSlugSet
    ? sponsoredSource.filter((entry) =>
        providerSlugSet.has(entry.row.providerSlug),
      )
    : sponsoredSource;
  const selectedIds = [
    ...selectedNatural.map((entry) => entry.row.providerModelId),
    ...selectedSponsored.map((entry) => entry.row.providerModelId),
    ...selectedObserving.map((entry) => entry.providerModelId),
  ];
  const trends = await loadTrends(db, [...new Set(selectedIds)], asOf);
  const rankByProviderModel = new Map(
    ranked.map((entry) => [entry.row.providerModelId, entry.naturalRank]),
  );
  const generatedAt = [
    ...selectedNatural.map((entry) => entry.row.lastCheckAt),
    ...selectedObserving.map((entry) => entry.lastCheckAt),
    ...selectedSponsored.map((entry) => entry.row.lastCheckAt),
  ].reduce<Date | null>(
    (latest, value) => (!value || (latest && latest >= value) ? latest : value),
    null,
  );

  return {
    model: presentMarketplaceModel({
      slug: model.slug,
      vendor: model.vendor,
      family: model.family,
      displayName: model.displayName,
      shortName: model.shortName,
      description: model.description,
    }),
    generatedAt: generatedAt?.toISOString() ?? null,
    sponsored: selectedSponsored.map((entry) => ({
      ...toLeaderboardRow(
        entry.row,
        rankByProviderModel.get(entry.row.providerModelId) ?? 0,
        trends,
      ),
      slot: entry.slot,
    })),
    ranking: selectedNatural.map((entry) =>
      toLeaderboardRow(entry.row, entry.naturalRank, trends),
    ),
    observing: selectedObserving.map((entry) => toObservingRow(entry, trends)),
  };
}

export async function getProviderRankings(
  db: MarketplaceDb,
  providerSlug: string,
  options: { asOf?: Date } = {},
): Promise<ProviderRankings | null> {
  const asOf = options.asOf ?? new Date();
  const [provider] = await db
    .select({
      slug: providers.slug,
      name: providers.name,
      description: providers.description,
      websiteUrl: providers.websiteUrl,
      logoUrl: providers.logoUrl,
    })
    .from(providers)
    .where(
      and(eq(providers.slug, providerSlug), eq(providers.status, "published")),
    )
    .limit(1);

  if (!provider) return null;

  const catalog = await db
    .select({
      slug: models.slug,
      vendor: models.vendor,
      family: models.family,
      displayName: models.displayName,
      sortOrder: models.sortOrder,
    })
    .from(models)
    .where(eq(models.enabled, true))
    .orderBy(asc(models.sortOrder), asc(models.slug));
  catalog.sort(compareMarketplaceModels);
  const leaderboards = await Promise.all(
    catalog.map((model) =>
      getModelLeaderboard(db, model.slug, {
        asOf,
        providerSlugs: [providerSlug],
      }),
    ),
  );
  const providerModels = leaderboards.flatMap((leaderboard) => {
    if (!leaderboard) return [];
    const ranking = leaderboard.ranking[0] ?? null;
    const observing = leaderboard.observing[0] ?? null;
    if (!ranking && !observing) return [];
    return [
      {
        model: leaderboard.model,
        generatedAt: leaderboard.generatedAt,
        ranking,
        observing,
      },
    ];
  });
  const generatedAt = providerModels.reduce<string | null>(
    (latest, model) =>
      !model.generatedAt || (latest && latest >= model.generatedAt)
        ? latest
        : model.generatedAt,
    null,
  );

  return {
    provider,
    generatedAt,
    models: providerModels,
  };
}

export async function getMarketplaceOverview(db: MarketplaceDb) {
  const [providerSummary] = await db
    .select({
      providerCount: sql<number>`count(*)::int`,
    })
    .from(providers)
    .where(eq(providers.status, "published"));
  const [freshnessSummary] = await db
    .select({
      latestStatsAt: sql<Date | null>`max(${providerModelStats.lastCheckAt})`,
    })
    .from(providerModelStats)
    .innerJoin(
      providerModels,
      eq(providerModels.id, providerModelStats.providerModelId),
    )
    .innerJoin(providers, eq(providers.id, providerModels.providerId))
    .where(eq(providers.status, "published"));

  const latestStatsValue = freshnessSummary?.latestStatsAt;
  const latestStatsAt =
    latestStatsValue instanceof Date
      ? latestStatsValue.toISOString()
      : latestStatsValue
        ? new Date(String(latestStatsValue)).toISOString()
        : null;

  return {
    providerCount: Number(providerSummary?.providerCount ?? 0),
    latestStatsAt,
  };
}

export async function getHomepageRankings(
  db: MarketplaceDb,
  options: { limit?: number; asOf?: Date } = {},
) {
  const catalog = await db
    .select({
      slug: models.slug,
      vendor: models.vendor,
      family: models.family,
      displayName: models.displayName,
      sortOrder: models.sortOrder,
    })
    .from(models)
    .where(eq(models.enabled, true))
    .orderBy(asc(models.sortOrder), asc(models.slug));
  catalog.sort(compareMarketplaceModels);
  const rankings = await Promise.all(
    catalog.map((model) => getModelLeaderboard(db, model.slug, options)),
  );

  return rankings.filter((ranking): ranking is ModelLeaderboard => !!ranking);
}
