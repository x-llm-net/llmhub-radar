import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
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
  calculateRankingScoreBps,
  calculateSevenDayStats,
  DEFAULT_MIN_RANKING_AVAILABILITY_BPS,
  deriveCurrentStatus,
  fillMissingBuckets,
  floorToBucket,
  getCompletedWindow,
  getQuotaPauseStartedAt,
  percentile,
  quotaPausePenaltyBps,
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
  firstTokenP50Ms: number | null;
  firstTokenP95Ms: number | null;
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
  firstTokenP50Ms: number | null;
  firstTokenP95Ms: number | null;
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

export async function listPublicMarketplaceModels(
  db: MarketplaceDb,
  options: { modelSlug?: string; providerSlug?: string } = {},
) {
  const activeAssociation = db
    .select({ id: providerModels.id })
    .from(providerModels)
    .innerJoin(providers, eq(providers.id, providerModels.providerId))
    .innerJoin(
      probeTargets,
      eq(probeTargets.providerModelId, providerModels.id),
    )
    .where(
      and(
        eq(providerModels.modelId, models.id),
        inArray(providerModels.status, ["observing", "ranked"]),
        eq(providers.status, "published"),
        eq(probeTargets.enabled, true),
        eq(probeTargets.isScoring, true),
        options.providerSlug
          ? eq(providers.slug, options.providerSlug)
          : undefined,
      ),
    );
  const visibilityCondition = options.providerSlug
    ? exists(activeAssociation)
    : or(eq(models.visibility, "show"), exists(activeAssociation));
  const catalog = await db
    .select({
      id: models.id,
      slug: models.slug,
      vendor: models.vendor,
      family: models.family,
      displayName: models.displayName,
      shortName: models.shortName,
      description: models.description,
      sortOrder: models.sortOrder,
    })
    .from(models)
    .where(
      and(
        eq(models.enabled, true),
        ne(models.visibility, "hide"),
        visibilityCondition,
        options.modelSlug ? eq(models.slug, options.modelSlug) : undefined,
      ),
    );

  catalog.sort(compareMarketplaceModels);
  return catalog;
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
      errorCode: probeChecks.errorCode,
      safeErrorSummary: probeChecks.safeErrorSummary,
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
      errorCode: probeChecks.errorCode,
      safeErrorSummary: probeChecks.safeErrorSummary,
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
    .limit(1000);
  const quotaPauseStartedAt = getQuotaPauseStartedAt(latestChecks);
  const status = quotaPauseStartedAt
    ? ("configuration_error" as const)
    : deriveCurrentStatus(latestChecks, asOf);
  const calculatedStats = calculateSevenDayStats(
    buckets,
    asOf,
    status,
    target.createdAt,
    minRankingAvailabilityBps,
    quotaPauseStartedAt !== null,
  );
  const firstTokenRows = await db
    .select({ firstTokenMs: probeChecks.firstTokenMs })
    .from(probeChecks)
    .where(
      and(
        eq(probeChecks.providerModelId, providerModelId),
        eq(probeChecks.attemptNo, 0),
        eq(probeChecks.outcome, "success"),
        isNotNull(probeChecks.firstTokenMs),
        gte(probeChecks.scheduledAt, windowStart),
        lt(probeChecks.scheduledAt, windowEnd),
      ),
    );
  const firstTokenValues = firstTokenRows.flatMap((row) =>
    row.firstTokenMs === null ? [] : [row.firstTokenMs],
  );
  const firstTokenP50Ms = percentile(firstTokenValues, 50);
  const firstTokenP95Ms = percentile(firstTokenValues, 95);
  const rankingScore = calculateRankingScoreBps({
    availabilityBps: calculatedStats.availabilityBps,
    firstTokenP50Ms,
    firstTokenP95Ms,
    sampleCount: calculatedStats.sampleCount,
    validBucketCount: calculatedStats.validBucketCount,
    pausePenaltyBps: quotaPausePenaltyBps(quotaPauseStartedAt, asOf),
  });
  const stats = {
    ...calculatedStats,
    firstTokenP50Ms,
    firstTokenP95Ms,
    rankingScoreBps: rankingScore,
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
        firstTokenP50Ms: stats.firstTokenP50Ms,
        firstTokenP95Ms: stats.firstTokenP95Ms,
        rankingScoreBps: stats.rankingScoreBps,
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
  firstTokenP50Ms: number | null;
  firstTokenP95Ms: number | null;
  rankingScoreBps: number | null;
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
    const score = row.rankingScoreBps ?? row.availabilityBps;
    if (score !== previousScore) {
      naturalRank += 1;
      previousScore = score;
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
    firstTokenP50Ms: source.firstTokenP50Ms,
    firstTokenP95Ms: source.firstTokenP95Ms,
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
    firstTokenP50Ms: source.firstTokenP50Ms,
    firstTokenP95Ms: source.firstTokenP95Ms,
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
  const [model] = await listPublicMarketplaceModels(db, { modelSlug });

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
      firstTokenP50Ms: providerModelStats.firstTokenP50Ms,
      firstTokenP95Ms: providerModelStats.firstTokenP95Ms,
      rankingScoreBps: providerModelStats.rankingScoreBps,
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
        or(
          gte(providerModelStats.lastCheckAt, freshnessCutoff),
          eq(providerModelStats.currentStatus, "configuration_error"),
        ),
        isNotNull(providerModelStats.availabilityBps),
        isNotNull(providerModelStats.grade),
      ),
    )
    .orderBy(
      desc(
        sql<number>`coalesce(${providerModelStats.rankingScoreBps}, ${providerModelStats.availabilityBps}, 0)`,
      ),
      desc(providerModelStats.availabilityBps),
      asc(providerModelStats.firstTokenP95Ms),
      asc(providerModelStats.firstTokenP50Ms),
      desc(providerModelStats.validBucketCount),
      desc(providerModelStats.sampleCount),
      asc(providers.slug),
    );
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
        firstTokenP50Ms: providerModelStats.firstTokenP50Ms,
        firstTokenP95Ms: providerModelStats.firstTokenP95Ms,
        rankingScoreBps: providerModelStats.rankingScoreBps,
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
        or(
          gte(providerModelStats.lastCheckAt, freshnessCutoff),
          eq(providerModelStats.currentStatus, "configuration_error"),
        ),
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
      firstTokenP50Ms: providerModelStats.firstTokenP50Ms,
      firstTokenP95Ms: providerModelStats.firstTokenP95Ms,
      rankingScoreBps: providerModelStats.rankingScoreBps,
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

  const catalog = await listPublicMarketplaceModels(db, { providerSlug });
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
  const catalog = await listPublicMarketplaceModels(db);
  const rankings = await Promise.all(
    catalog.map((model) => getModelLeaderboard(db, model.slug, options)),
  );

  return rankings.filter((ranking): ranking is ModelLeaderboard => !!ranking);
}
