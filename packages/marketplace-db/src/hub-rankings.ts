import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  or,
} from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import { compareMarketplaceModels } from "./model-metadata";
import {
  hubGroupBlocks,
  hubGroupModels,
  hubGroupModelStats,
  hubGroupPriceVersions,
  hubHealthBuckets3h,
  hubModels,
  hubProbeTargets,
  hubProviderGroups,
  hubProviders,
} from "./schema";
import {
  BUCKET_COUNT,
  BUCKET_MS,
  floorToBucket,
  quotaPausePenaltyBps,
} from "./scoring";

export type HubTrendBucket = {
  startsAt: string;
  availabilityBps: number | null;
  sampleCount: number;
};

export type HubLeaderboardRow = {
  providerModelId: string;
  provider: { slug: string; name: string; logoUrl: string | null };
  group: { id: string; name: string; multiplierBps: number | null };
  providerModelName: string;
  purchaseUrl: string | null;
  availabilityBps: number | null;
  coverageBps: number;
  grade: "S" | "A" | "B" | "C" | "D" | null;
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
  eligibilityReason: string | null;
  naturalRank: number;
  trend: HubTrendBucket[];
};

export type HubModelLeaderboard = {
  model: {
    slug: string;
    vendor: string;
    family: string;
    displayName: string;
    shortName: string;
    description: string;
  };
  generatedAt: string | null;
  sponsored: Array<HubLeaderboardRow & { slot: number }>;
  ranking: HubLeaderboardRow[];
  observing: HubLeaderboardRow[];
};

export async function listPublicHubModels(
  db: MarketplaceDb,
  options: { modelSlug?: string; providerSlug?: string } = {},
) {
  const rows = await db
    .selectDistinct({
      id: hubModels.id,
      slug: hubModels.slug,
      vendor: hubModels.vendor,
      family: hubModels.family,
      displayName: hubModels.displayName,
      shortName: hubModels.shortName,
      description: hubModels.description,
      sortOrder: hubModels.sortOrder,
      updatedAt: hubModels.updatedAt,
    })
    .from(hubModels)
    .innerJoin(hubGroupModels, eq(hubGroupModels.modelId, hubModels.id))
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(
      and(
        ne(hubModels.status, "retired"),
        eq(hubGroupModels.discoveryStatus, "active"),
        eq(hubGroupModels.probeEnabled, true),
        eq(hubProviderGroups.listingStatus, "listed"),
        inArray(hubProviderGroups.lifecycleStatus, ["verifying", "ready"]),
        ne(hubProviderGroups.desiredStatus, "retired"),
        eq(hubProviders.status, "active"),
        options.modelSlug ? eq(hubModels.slug, options.modelSlug) : undefined,
        options.providerSlug
          ? eq(hubProviders.slug, options.providerSlug)
          : undefined,
      ),
    );
  rows.sort(compareMarketplaceModels);
  return rows;
}

export async function getHubModelLeaderboard(
  db: MarketplaceDb,
  modelSlug: string,
  options: { asOf?: Date; rankingLimit?: number } = {},
): Promise<HubModelLeaderboard | null> {
  const [model] = await listPublicHubModels(db, { modelSlug });
  if (!model) return null;
  const asOf = options.asOf ?? new Date();
  const rows = await getModelRows(db, model.id, asOf);
  const ranking = rows
    .filter((row) => row.eligible && row.rankingScoreBps !== null)
    .sort(compareRows)
    .slice(0, options.rankingLimit ?? 10)
    .map((row, index, values) =>
      presentRow(row, rankFor(values, index), row.trend),
    );
  const observing = rows
    .filter((row) => !row.eligible || row.rankingScoreBps === null)
    .sort(compareObservingRows)
    .map((row) => presentRow(row, 0, row.trend));
  const generatedAt = rows
    .map((row) => row.statsUpdatedAt)
    .filter((value): value is Date => value !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    model: {
      slug: model.slug,
      vendor: model.vendor,
      family: model.family,
      displayName: model.displayName,
      shortName: model.shortName,
      description: model.description,
    },
    generatedAt: generatedAt?.toISOString() ?? null,
    sponsored: [],
    ranking,
    observing,
  };
}

export async function getHubHomepageRankings(
  db: MarketplaceDb,
  options: { asOf?: Date } = {},
) {
  const catalog = await listPublicHubModels(db);
  const boards = await Promise.all(
    catalog.map((model) =>
      getHubModelLeaderboard(db, model.slug, { asOf: options.asOf }),
    ),
  );
  return boards.filter((board): board is HubModelLeaderboard => board !== null);
}

export async function getHubMarketplaceOverview(db: MarketplaceDb) {
  const providers = await db
    .selectDistinct({ id: hubProviders.id })
    .from(hubProviders)
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.providerId, hubProviders.id),
    )
    .where(
      and(
        eq(hubProviders.status, "active"),
        eq(hubProviderGroups.listingStatus, "listed"),
        ne(hubProviderGroups.desiredStatus, "retired"),
      ),
    );
  const [latest] = await db
    .select({ updatedAt: hubGroupModelStats.updatedAt })
    .from(hubGroupModelStats)
    .orderBy(desc(hubGroupModelStats.updatedAt))
    .limit(1);
  return {
    providerCount: providers.length,
    latestStatsAt: latest?.updatedAt.toISOString() ?? null,
  };
}

export async function listPublicHubProviders(db: MarketplaceDb) {
  return db
    .selectDistinct({
      slug: hubProviders.slug,
      name: hubProviders.displayName,
      updatedAt: hubProviders.updatedAt,
    })
    .from(hubProviders)
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.providerId, hubProviders.id),
    )
    .where(
      and(
        eq(hubProviders.status, "active"),
        eq(hubProviderGroups.listingStatus, "listed"),
        ne(hubProviderGroups.desiredStatus, "retired"),
      ),
    )
    .orderBy(asc(hubProviders.displayName));
}

export async function getHubProviderRankings(
  db: MarketplaceDb,
  providerSlug: string,
  options: { asOf?: Date } = {},
) {
  const [provider] = await db
    .select({
      slug: hubProviders.slug,
      name: hubProviders.displayName,
      description: hubProviders.description,
      websiteUrl: hubProviders.websiteUrl,
    })
    .from(hubProviders)
    .where(
      and(
        eq(hubProviders.slug, providerSlug),
        eq(hubProviders.status, "active"),
      ),
    )
    .limit(1);
  if (!provider) return null;
  const catalog = await listPublicHubModels(db, { providerSlug });
  const boards = await Promise.all(
    catalog.map((model) =>
      getHubModelLeaderboard(db, model.slug, {
        asOf: options.asOf,
        rankingLimit: Number.MAX_SAFE_INTEGER,
      }),
    ),
  );
  return {
    provider: { ...provider, logoUrl: null },
    generatedAt:
      boards
        .map((board) => board?.generatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    models: boards.flatMap((board) => {
      if (!board) return [];
      const ranking = board.ranking.filter(
        (row) => row.provider.slug === providerSlug,
      );
      const observing = board.observing.filter(
        (row) => row.provider.slug === providerSlug,
      );
      return [
        ...ranking.map((row) => ({
          model: board.model,
          generatedAt: board.generatedAt,
          ranking: row,
          observing: null,
        })),
        ...observing.map((row) => ({
          model: board.model,
          generatedAt: board.generatedAt,
          ranking: null,
          observing: row,
        })),
      ];
    }),
  };
}

async function getModelRows(db: MarketplaceDb, modelId: string, asOf: Date) {
  const now = new Date();
  const rows = await db
    .select({
      groupModelId: hubGroupModels.id,
      upstreamName: hubGroupModels.upstreamModelName,
      providerSlug: hubProviders.slug,
      providerName: hubProviders.displayName,
      groupId: hubProviderGroups.id,
      groupName: hubProviderGroups.name,
      multiplierBps: hubGroupPriceVersions.multiplierBps,
      availabilityBps: hubGroupModelStats.availabilityBps,
      coverageBps: hubGroupModelStats.coverageBps,
      grade: hubGroupModelStats.grade,
      firstTokenP50Ms: hubGroupModelStats.firstTokenP50Ms,
      firstTokenP95Ms: hubGroupModelStats.firstTokenP95Ms,
      sampleCount: hubGroupModelStats.sampleCount,
      validBucketCount: hubGroupModelStats.validBucketCount,
      rankingScoreBps: hubGroupModelStats.rankingScoreBps,
      currentStatus: hubGroupModelStats.currentStatus,
      eligible: hubGroupModelStats.eligible,
      eligibilityReason: hubGroupModelStats.eligibilityReason,
      lastCheckAt: hubGroupModelStats.lastCheckAt,
      statsUpdatedAt: hubGroupModelStats.updatedAt,
      intervalSeconds: hubProbeTargets.intervalSeconds,
      quotaPausedSince: hubGroupBlocks.createdAt,
    })
    .from(hubGroupModels)
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .innerJoin(
      hubProbeTargets,
      eq(hubProbeTargets.groupModelId, hubGroupModels.id),
    )
    .leftJoin(
      hubGroupBlocks,
      and(
        eq(hubGroupBlocks.groupId, hubProviderGroups.id),
        eq(hubGroupBlocks.source, "balance"),
        eq(hubGroupBlocks.reasonCode, "insufficient_quota"),
        isNull(hubGroupBlocks.resolvedAt),
      ),
    )
    .leftJoin(
      hubGroupModelStats,
      eq(hubGroupModelStats.groupModelId, hubGroupModels.id),
    )
    .leftJoin(
      hubGroupPriceVersions,
      and(
        eq(hubGroupPriceVersions.groupId, hubProviderGroups.id),
        lte(hubGroupPriceVersions.effectiveFrom, now),
        or(
          isNull(hubGroupPriceVersions.effectiveTo),
          gt(hubGroupPriceVersions.effectiveTo, now),
        ),
      ),
    )
    .where(
      and(
        eq(hubGroupModels.modelId, modelId),
        eq(hubGroupModels.discoveryStatus, "active"),
        eq(hubGroupModels.probeEnabled, true),
        eq(hubProviderGroups.listingStatus, "listed"),
        eq(hubProviderGroups.desiredStatus, "active"),
        inArray(hubProviderGroups.lifecycleStatus, ["verifying", "ready"]),
        eq(hubProviders.status, "active"),
        notBlockingTraffic(db),
      ),
    );
  const trends = await loadTrends(
    db,
    rows.map((row) => row.groupModelId),
    asOf,
  );
  return rows.map((row) => {
    const staleAfterMs = Math.max(
      30 * 60 * 1000,
      row.intervalSeconds * 3 * 1000,
    );
    const stale =
      row.quotaPausedSince === null &&
      row.lastCheckAt !== null &&
      asOf.getTime() - row.lastCheckAt.getTime() > staleAfterMs;
    return {
      ...row,
      availabilityBps: row.availabilityBps ?? null,
      coverageBps: row.coverageBps ?? 0,
      firstTokenP50Ms: row.firstTokenP50Ms ?? null,
      firstTokenP95Ms: row.firstTokenP95Ms ?? null,
      sampleCount: row.sampleCount ?? 0,
      validBucketCount: row.validBucketCount ?? 0,
      rankingScoreBps:
        row.rankingScoreBps === null
          ? null
          : Math.max(
              0,
              row.rankingScoreBps -
                quotaPausePenaltyBps(row.quotaPausedSince, asOf),
            ),
      currentStatus: stale ? "stale" : (row.currentStatus ?? "unknown"),
      eligible: stale ? false : (row.eligible ?? false),
      eligibilityReason: stale
        ? "stale"
        : (row.eligibilityReason ?? "no_scoreable_samples"),
      lastCheckAt: row.lastCheckAt ?? null,
      statsUpdatedAt: row.statsUpdatedAt ?? null,
      trend: trends.get(row.groupModelId) ?? emptyTrend(asOf),
    };
  });
}

function notBlockingTraffic(db: MarketplaceDb) {
  return notExists(
    db
      .select({ id: hubGroupBlocks.id })
      .from(hubGroupBlocks)
      .where(
        and(
          eq(hubGroupBlocks.groupId, hubProviderGroups.id),
          eq(hubGroupBlocks.stopsTraffic, true),
          isNull(hubGroupBlocks.resolvedAt),
          or(
            ne(hubGroupBlocks.source, "balance"),
            ne(hubGroupBlocks.reasonCode, "insufficient_quota"),
          ),
        ),
      )
      .limit(1),
  );
}

async function loadTrends(
  db: MarketplaceDb,
  groupModelIds: string[],
  asOf: Date,
) {
  const starts = emptyTrend(asOf);
  const map = new Map(
    groupModelIds.map((id) => [id, starts.map((item) => ({ ...item }))]),
  );
  if (groupModelIds.length === 0) return map;
  const start = new Date(starts[0]?.startsAt ?? asOf);
  const buckets = await db
    .select({
      groupModelId: hubHealthBuckets3h.groupModelId,
      startsAt: hubHealthBuckets3h.bucketStart,
      availabilityBps: hubHealthBuckets3h.availabilityBps,
      sampleCount: hubHealthBuckets3h.successCount,
      failureCount: hubHealthBuckets3h.providerFailureCount,
    })
    .from(hubHealthBuckets3h)
    .where(
      and(
        inArray(hubHealthBuckets3h.groupModelId, groupModelIds),
        gte(hubHealthBuckets3h.bucketStart, start),
      ),
    );
  for (const bucket of buckets) {
    const values = map.get(bucket.groupModelId);
    const index = values?.findIndex(
      (item) => new Date(item.startsAt).getTime() === bucket.startsAt.getTime(),
    );
    if (values && index !== undefined && index >= 0) {
      values[index] = {
        startsAt: bucket.startsAt.toISOString(),
        availabilityBps: bucket.availabilityBps,
        sampleCount: bucket.sampleCount + bucket.failureCount,
      };
    }
  }
  return map;
}

function emptyTrend(asOf: Date): HubTrendBucket[] {
  const end = floorToBucket(asOf);
  return Array.from({ length: BUCKET_COUNT }, (_, index) => ({
    startsAt: new Date(
      end.getTime() - (BUCKET_COUNT - index) * BUCKET_MS,
    ).toISOString(),
    availabilityBps: null,
    sampleCount: 0,
  }));
}

function compareRows(
  left: Awaited<ReturnType<typeof getModelRows>>[number],
  right: Awaited<ReturnType<typeof getModelRows>>[number],
) {
  return (
    (right.rankingScoreBps ?? 0) - (left.rankingScoreBps ?? 0) ||
    (right.availabilityBps ?? 0) - (left.availabilityBps ?? 0) ||
    (left.firstTokenP50Ms ?? Number.MAX_SAFE_INTEGER) -
      (right.firstTokenP50Ms ?? Number.MAX_SAFE_INTEGER) ||
    left.providerName.localeCompare(right.providerName) ||
    left.groupName.localeCompare(right.groupName)
  );
}

function compareObservingRows(
  left: Awaited<ReturnType<typeof getModelRows>>[number],
  right: Awaited<ReturnType<typeof getModelRows>>[number],
) {
  return (
    right.sampleCount - left.sampleCount ||
    left.providerName.localeCompare(right.providerName) ||
    left.groupName.localeCompare(right.groupName)
  );
}

function rankFor(
  rows: Awaited<ReturnType<typeof getModelRows>>,
  index: number,
): number {
  if (index === 0) return 1;
  return rows[index]?.rankingScoreBps === rows[index - 1]?.rankingScoreBps
    ? rankFor(rows, index - 1)
    : index + 1;
}

function presentRow(
  row: Awaited<ReturnType<typeof getModelRows>>[number],
  naturalRank: number,
  trend: HubTrendBucket[],
): HubLeaderboardRow {
  return {
    providerModelId: row.groupModelId,
    provider: { slug: row.providerSlug, name: row.providerName, logoUrl: null },
    group: {
      id: row.groupId,
      name: row.groupName,
      multiplierBps: row.multiplierBps,
    },
    providerModelName: `${row.groupName} · ${row.upstreamName}`,
    purchaseUrl: null,
    availabilityBps: row.availabilityBps,
    coverageBps: row.coverageBps,
    grade: row.grade,
    firstTokenP50Ms: row.firstTokenP50Ms,
    firstTokenP95Ms: row.firstTokenP95Ms,
    sampleCount: row.sampleCount,
    validBucketCount: row.validBucketCount,
    currentStatus: row.currentStatus,
    lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
    eligibilityReason: row.eligibilityReason,
    naturalRank,
    trend,
  };
}
