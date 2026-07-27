import { and, eq, inArray, sql } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import { refreshProviderModelStats } from "./repository";
import {
  healthBuckets3h,
  models,
  probeChecks,
  probeTargets,
  providerModels,
  providers,
} from "./schema";
import { DEFAULT_MIN_RANKING_AVAILABILITY_BPS } from "./scoring";
import { setMarketplaceMinRankingAvailabilityBps } from "./settings";

const CONFIGURATION_ERRORS = new Set([
  "auth_error",
  "insufficient_quota",
  "model_not_found",
]);
const DEFAULT_BASE_URL = "https://llm-hub.store";
const INSERT_BATCH_SIZE = 500;
const DEFAULT_FETCH_CONCURRENCY = 12;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_STATS_CONCURRENCY = 8;
const LEGACY_DIRECTORY_PAGE_SIZE = 24;
const BUCKET_SECONDS = 3 * 60 * 60;

type LegacyRun = {
  id: number;
  startedAt: string;
  success: boolean;
  httpStatus: number | null;
  errorType: string | null;
  firstTokenMs: number | null;
  totalLatencyMs: number | null;
};

type LegacyBucket = {
  from: string;
  to: string;
  ok: number;
  degraded: number;
  error: number;
  availability: number | null;
};

type LegacyTarget = {
  id: number;
  displayName: string;
  serviceGroupName: string;
  modelName: string;
  intervalSeconds: number;
  currentStatus: string;
  stabilityBuckets7d: LegacyBucket[];
  recentRuns: LegacyRun[];
};

type LegacyPublicPage = {
  title: string;
  description: string;
  icon: string | null;
  slug: string;
  homepageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  radar: {
    targets: LegacyTarget[];
  } | null;
};

type LegacyDirectoryPage = {
  items: Array<{
    page: { slug: string };
  }>;
  totalSize: number;
  limit: number;
  offset: number;
};

export type LegacyRadarSyncResult = {
  providers: number;
  listings: number;
  targets: number;
  scoringTargets: number;
  checksRead: number;
  checksInserted: number;
  skippedModels: string[];
  failedProviders: Array<{ slug: string; error: string }>;
  failedProviderModels: Array<{ providerModelId: string; error: string }>;
  minRankingAvailabilityBps: number;
};

export function mapLegacyOutcome(args: {
  success: boolean;
  errorType: string | null;
}) {
  if (args.success) return "success" as const;
  if (args.errorType && CONFIGURATION_ERRORS.has(args.errorType)) {
    return "configuration_error" as const;
  }
  return "provider_failure" as const;
}

function normalizedModelName(value: string) {
  return value.trim().toLowerCase();
}

function modelSlug(value: string) {
  return (
    normalizedModelName(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferModelMetadata(name: string) {
  const lower = normalizedModelName(name);
  if (lower.startsWith("claude")) {
    return { vendor: "Anthropic", family: "Claude" };
  }
  if (
    lower.startsWith("gpt") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3")
  ) {
    return { vendor: "OpenAI", family: "GPT" };
  }
  if (lower.startsWith("gemini")) {
    return { vendor: "Google", family: "Gemini" };
  }
  if (lower.startsWith("grok")) {
    return { vendor: "xAI", family: "Grok" };
  }
  return { vendor: "Other", family: "Other" };
}

function ratioToBps(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.min(10_000, Math.round((numerator / denominator) * 10_000));
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  if (values.length === 0) return [] as R[];
  const results: R[] = [];
  results.length = values.length;
  let nextIndex = 0;
  const workerCount = Math.min(
    values.length,
    Math.max(1, Math.floor(concurrency)),
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await mapper(values[index] as T, index);
      }
    }),
  );

  return results;
}

export function expectedLegacyChecksPerBucket(
  intervalSeconds: number,
  observedSampleCounts: number[] = [],
) {
  const theoretical = Math.max(1, Math.floor(BUCKET_SECONDS / intervalSeconds));
  const observed = observedSampleCounts
    .filter((count) => count > 0)
    .sort((left, right) => left - right);
  if (observed.length === 0) return theoretical;

  const upperQuartile = observed[
    Math.floor((observed.length - 1) * 0.75)
  ] as number;
  return Math.max(1, Math.min(theoretical, upperQuartile));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function asLegacyPublicPage(value: unknown): LegacyPublicPage {
  const page = (
    value as Array<{
      result?: { data?: { json?: LegacyPublicPage } };
    }>
  )?.[0]?.result?.data?.json;

  if (!page?.slug || !page.radar || !Array.isArray(page.radar.targets)) {
    throw new Error("Legacy Radar returned an invalid public page payload");
  }

  return page;
}

function asLegacyDirectoryPage(value: unknown): LegacyDirectoryPage {
  const directory = (
    value as Array<{
      result?: { data?: { json?: LegacyDirectoryPage } };
    }>
  )?.[0]?.result?.data?.json;

  if (!directory || !Array.isArray(directory.items)) {
    throw new Error(
      "Legacy Radar returned an invalid public directory payload",
    );
  }

  return directory;
}

async function fetchLegacyPublicPage(args: {
  baseUrl: string;
  slug: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
}) {
  const input = encodeURIComponent(
    JSON.stringify({ "0": { json: { slug: args.slug } } }),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await args.fetchFn(
      `${args.baseUrl}/api/trpc/edge/statusPage.get?batch=1&input=${input}`,
      {
        headers: {
          accept: "application/json",
          "x-trpc-source": "client",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Legacy Radar request for ${args.slug} failed with HTTP ${response.status}`,
      );
    }

    return asLegacyPublicPage(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLegacyPublicDirectoryPage(args: {
  baseUrl: string;
  limit: number;
  offset: number;
  fetchFn: typeof fetch;
  timeoutMs: number;
}) {
  const input = encodeURIComponent(
    JSON.stringify({
      "0": { json: { limit: args.limit, offset: args.offset } },
    }),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await args.fetchFn(
      `${args.baseUrl}/api/trpc/edge/statusPage.listPublicRadar?batch=1&input=${input}`,
      {
        headers: {
          accept: "application/json",
          "x-trpc-source": "client",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Legacy Radar directory request failed with HTTP ${response.status}`,
      );
    }

    return asLegacyDirectoryPage(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLegacyPublicSlugs(args: {
  baseUrl: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
}) {
  const slugs: string[] = [];
  let offset = 0;
  let totalSize = Number.POSITIVE_INFINITY;

  while (offset < totalSize) {
    const page = await fetchLegacyPublicDirectoryPage({
      ...args,
      limit: LEGACY_DIRECTORY_PAGE_SIZE,
      offset,
    });
    totalSize = page.totalSize;
    slugs.push(...page.items.map((item) => item.page.slug));
    if (page.items.length === 0) break;
    offset += page.items.length;
  }

  return uniqueStrings(slugs);
}

async function resolveMarketplaceModel(args: {
  db: MarketplaceDb;
  modelByAlias: Map<string, typeof models.$inferSelect>;
  modelName: string;
  now: Date;
}) {
  const normalized = normalizedModelName(args.modelName);
  const existing = args.modelByAlias.get(normalized);
  if (existing) return existing;

  const slug = modelSlug(args.modelName);
  const metadata = inferModelMetadata(args.modelName);
  const aliases = uniqueStrings([args.modelName, slug]);
  const [inserted] = await args.db
    .insert(models)
    .values({
      slug,
      vendor: metadata.vendor,
      family: metadata.family,
      displayName: args.modelName,
      shortName: args.modelName,
      description: "",
      aliases,
      sortOrder: 10_000,
      enabled: true,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing({
      target: models.slug,
    })
    .returning();
  const model =
    inserted ??
    (
      await args.db.select().from(models).where(eq(models.slug, slug)).limit(1)
    )[0];
  if (!model) {
    throw new Error(`Could not create marketplace model for ${args.modelName}`);
  }

  for (const alias of [model.slug, ...model.aliases, args.modelName]) {
    args.modelByAlias.set(normalizedModelName(alias), model);
  }
  return model;
}

export async function syncLegacyRadar(args: {
  db: MarketplaceDb;
  baseUrl?: string;
  slugs?: string[];
  fetchFn?: typeof fetch;
  now?: Date;
  minRankingAvailabilityBps?: number;
  fetchConcurrency?: number;
  fetchTimeoutMs?: number;
  statsConcurrency?: number;
}): Promise<LegacyRadarSyncResult> {
  const now = args.now ?? new Date();
  const baseUrl = (args.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchFn = args.fetchFn ?? fetch;
  const slugs =
    args.slugs && args.slugs.length > 0
      ? uniqueStrings(args.slugs)
      : await fetchLegacyPublicSlugs({
          baseUrl,
          fetchFn,
          timeoutMs: args.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
        });
  const minRankingAvailabilityBps =
    args.minRankingAvailabilityBps ?? DEFAULT_MIN_RANKING_AVAILABILITY_BPS;
  const fetchResults = await mapWithConcurrency(
    slugs,
    args.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY,
    async (slug) => {
      try {
        return {
          slug,
          page: await fetchLegacyPublicPage({
            baseUrl,
            slug,
            fetchFn,
            timeoutMs: args.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
          }),
          error: null,
        };
      } catch (error) {
        return { slug, page: null, error: errorMessage(error) };
      }
    },
  );
  const pages = fetchResults.flatMap((result) =>
    result.page ? [result.page] : [],
  );
  const failedProviders = fetchResults.flatMap((result) =>
    result.error ? [{ slug: result.slug, error: result.error }] : [],
  );

  const modelRows = await args.db.select().from(models);
  const modelByAlias = new Map<string, (typeof modelRows)[number]>();
  for (const model of modelRows) {
    for (const alias of [model.slug, ...model.aliases]) {
      modelByAlias.set(normalizedModelName(alias), model);
    }
  }

  const skippedModels = new Set<string>();
  const listingTargets = new Map<
    string,
    {
      providerModelId: string;
      createdAt: Date;
      targets: LegacyTarget[];
    }
  >();
  let providerCount = 0;

  for (const page of pages) {
    const [provider] = await args.db
      .insert(providers)
      .values({
        slug: page.slug,
        name: page.title,
        description: page.description,
        websiteUrl: page.homepageUrl || null,
        logoUrl: page.icon || null,
        status: "published",
        verifiedAt: new Date(page.createdAt),
        createdAt: new Date(page.createdAt),
        updatedAt: new Date(page.updatedAt),
      })
      .onConflictDoUpdate({
        target: providers.slug,
        set: {
          name: page.title,
          description: page.description,
          websiteUrl: page.homepageUrl || null,
          logoUrl: page.icon || null,
          status: "published",
          updatedAt: new Date(page.updatedAt),
        },
      })
      .returning({ id: providers.id });
    if (!provider) continue;
    providerCount += 1;

    const existingListings = await args.db
      .select({
        id: providerModels.id,
        modelId: providerModels.modelId,
        status: providerModels.status,
      })
      .from(providerModels)
      .where(eq(providerModels.providerId, provider.id));
    const existingListingByModel = new Map(
      existingListings.map((listing) => [listing.modelId, listing]),
    );
    const seenModelIds = new Set<string>();
    const targetsByModel = new Map<string, LegacyTarget[]>();

    for (const target of page.radar?.targets ?? []) {
      if (!target.modelName.trim()) {
        skippedModels.add(target.modelName);
        continue;
      }
      const model = await resolveMarketplaceModel({
        db: args.db,
        modelByAlias,
        modelName: target.modelName,
        now,
      });
      const values = targetsByModel.get(model.id) ?? [];
      values.push(target);
      targetsByModel.set(model.id, values);
    }

    for (const [modelId, targets] of targetsByModel) {
      targets.sort((left, right) => left.id - right.id);
      const primary = targets[0];
      if (!primary) continue;
      seenModelIds.add(modelId);
      const createdAt = new Date(page.createdAt);
      const [listing] = await args.db
        .insert(providerModels)
        .values({
          providerId: provider.id,
          modelId,
          providerModelName: primary.modelName,
          purchaseUrl: page.homepageUrl || null,
          status: "observing",
          publishedAt: new Date(page.createdAt),
          createdAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [providerModels.providerId, providerModels.modelId],
          set: {
            providerModelName: primary.modelName,
            purchaseUrl: page.homepageUrl || null,
            createdAt,
            updatedAt: now,
          },
        })
        .returning({ id: providerModels.id });
      if (!listing) continue;

      if (existingListingByModel.get(modelId)?.status === "retired") {
        await args.db
          .update(providerModels)
          .set({ status: "observing", updatedAt: now })
          .where(eq(providerModels.id, listing.id));
      }

      listingTargets.set(`${page.slug}:${modelId}`, {
        providerModelId: listing.id,
        createdAt,
        targets,
      });
    }

    const retiredListingIds = existingListings
      .filter((listing) => !seenModelIds.has(listing.modelId))
      .map((listing) => listing.id);
    if (retiredListingIds.length > 0) {
      await args.db
        .update(probeTargets)
        .set({ enabled: false, isScoring: false, updatedAt: now })
        .where(inArray(probeTargets.providerModelId, retiredListingIds));
      await args.db
        .update(providerModels)
        .set({ status: "retired", updatedAt: now })
        .where(inArray(providerModels.id, retiredListingIds));
    }
  }

  if (!args.slugs) {
    const syncedSlugs = new Set(pages.map((page) => page.slug));
    const legacyProviderRows = await args.db
      .select({ id: providers.id, slug: providers.slug })
      .from(providers)
      .innerJoin(providerModels, eq(providerModels.providerId, providers.id))
      .innerJoin(
        probeTargets,
        eq(probeTargets.providerModelId, providerModels.id),
      )
      .where(eq(probeTargets.source, "legacy_radar"));
    const removedProviderIds = [
      ...new Map(
        legacyProviderRows
          .filter((provider) => !syncedSlugs.has(provider.slug))
          .map((provider) => [provider.id, provider]),
      ).keys(),
    ];
    if (removedProviderIds.length > 0) {
      await args.db
        .update(providers)
        .set({ status: "observing", updatedAt: now })
        .where(inArray(providers.id, removedProviderIds));
    }
  }

  const scoringTargets: Array<{
    providerModelId: string;
    targetId: string;
    source: LegacyTarget;
  }> = [];
  let targetCount = 0;

  for (const [listingKey, listing] of listingTargets) {
    await args.db
      .update(probeTargets)
      .set({ isScoring: false, updatedAt: now })
      .where(
        and(
          eq(probeTargets.providerModelId, listing.providerModelId),
          eq(probeTargets.source, "legacy_radar"),
        ),
      );

    const currentSourceRefs = new Set<string>();
    for (const [index, source] of listing.targets.entries()) {
      const sourceRef = `${listingKey}:${source.id}`;
      currentSourceRefs.add(sourceRef);
      const [target] = await args.db
        .insert(probeTargets)
        .values({
          providerModelId: listing.providerModelId,
          name: source.serviceGroupName || source.displayName,
          source: "legacy_radar",
          sourceRef,
          endpointType: "openai_compatible",
          intervalSeconds: source.intervalSeconds,
          isScoring: index === 0,
          enabled: true,
          createdAt: listing.createdAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [probeTargets.source, probeTargets.sourceRef],
          set: {
            providerModelId: listing.providerModelId,
            name: source.serviceGroupName || source.displayName,
            intervalSeconds: source.intervalSeconds,
            isScoring: index === 0,
            enabled: true,
            createdAt: listing.createdAt,
            updatedAt: now,
          },
        })
        .returning({ id: probeTargets.id });
      if (!target) continue;
      targetCount += 1;

      if (index === 0) {
        scoringTargets.push({
          providerModelId: listing.providerModelId,
          targetId: target.id,
          source,
        });
      }
    }

    const storedLegacyTargets = await args.db
      .select({ id: probeTargets.id, sourceRef: probeTargets.sourceRef })
      .from(probeTargets)
      .where(
        and(
          eq(probeTargets.providerModelId, listing.providerModelId),
          eq(probeTargets.source, "legacy_radar"),
        ),
      );
    const removedTargetIds = storedLegacyTargets
      .filter(
        (target) =>
          !target.sourceRef || !currentSourceRefs.has(target.sourceRef),
      )
      .map((target) => target.id);
    if (removedTargetIds.length > 0) {
      await args.db
        .update(probeTargets)
        .set({ enabled: false, isScoring: false, updatedAt: now })
        .where(inArray(probeTargets.id, removedTargetIds));
    }
  }

  const checkValues = scoringTargets.flatMap((target) =>
    target.source.recentRuns.map((run) => {
      const startedAt = new Date(run.startedAt);
      return {
        targetId: target.targetId,
        providerModelId: target.providerModelId,
        scheduledAt: startedAt,
        startedAt,
        finishedAt:
          run.totalLatencyMs === null
            ? null
            : new Date(startedAt.getTime() + run.totalLatencyMs),
        attemptNo: 0,
        outcome: mapLegacyOutcome(run),
        errorCode: run.errorType,
        httpStatus: run.httpStatus,
        firstTokenMs: run.firstTokenMs,
        totalLatencyMs: run.totalLatencyMs,
        createdAt: startedAt,
      };
    }),
  );

  let checksInserted = 0;
  for (const batch of chunks(checkValues, INSERT_BATCH_SIZE)) {
    const inserted = await args.db
      .insert(probeChecks)
      .values(batch)
      .onConflictDoNothing({
        target: [
          probeChecks.targetId,
          probeChecks.scheduledAt,
          probeChecks.attemptNo,
        ],
      })
      .returning({ id: probeChecks.id });
    checksInserted += inserted.length;
  }

  const bucketValues = scoringTargets.flatMap((target) => {
    const expectedCount = expectedLegacyChecksPerBucket(
      target.source.intervalSeconds,
      target.source.stabilityBuckets7d.map(
        (bucket) => bucket.ok + bucket.degraded + bucket.error,
      ),
    );

    return target.source.stabilityBuckets7d.map((bucket) => {
      const successCount = bucket.ok + bucket.degraded;
      const providerFailureCount = bucket.error;
      const sampleCount = successCount + providerFailureCount;
      return {
        providerModelId: target.providerModelId,
        bucketStart: new Date(bucket.from),
        expectedCount,
        attemptedCount: sampleCount,
        successCount,
        providerFailureCount,
        configurationErrorCount: 0,
        observerErrorCount: 0,
        slowSuccessCount: bucket.degraded,
        availabilityBps:
          sampleCount === 0 ? null : ratioToBps(successCount, sampleCount),
        coverageBps: ratioToBps(sampleCount, expectedCount),
        lastCheckAt: sampleCount === 0 ? null : new Date(bucket.to),
        updatedAt: now,
      };
    });
  });

  for (const batch of chunks(bucketValues, INSERT_BATCH_SIZE)) {
    await args.db
      .insert(healthBuckets3h)
      .values(batch)
      .onConflictDoUpdate({
        target: [healthBuckets3h.providerModelId, healthBuckets3h.bucketStart],
        set: {
          expectedCount: sql`excluded.expected_count`,
          attemptedCount: sql`excluded.attempted_count`,
          successCount: sql`excluded.success_count`,
          providerFailureCount: sql`excluded.provider_failure_count`,
          configurationErrorCount: sql`excluded.configuration_error_count`,
          observerErrorCount: sql`excluded.observer_error_count`,
          slowSuccessCount: sql`excluded.slow_success_count`,
          availabilityBps: sql`excluded.availability_bps`,
          coverageBps: sql`excluded.coverage_bps`,
          lastCheckAt: sql`excluded.last_check_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  const activeScoringRows = await args.db
    .select({ providerModelId: probeTargets.providerModelId })
    .from(probeTargets)
    .where(
      and(eq(probeTargets.enabled, true), eq(probeTargets.isScoring, true)),
    );
  const activeProviderModelIds = [
    ...new Set(activeScoringRows.map((row) => row.providerModelId)),
  ];
  const statsResults = await mapWithConcurrency(
    activeProviderModelIds,
    args.statsConcurrency ?? DEFAULT_STATS_CONCURRENCY,
    async (providerModelId) => {
      try {
        await refreshProviderModelStats(
          args.db,
          providerModelId,
          now,
          minRankingAvailabilityBps,
        );
        return { providerModelId, error: null };
      } catch (error) {
        return { providerModelId, error: errorMessage(error) };
      }
    },
  );
  const failedProviderModels = statsResults.flatMap((result) =>
    result.error
      ? [{ providerModelId: result.providerModelId, error: result.error }]
      : [],
  );

  if (failedProviderModels.length === 0) {
    await setMarketplaceMinRankingAvailabilityBps(
      args.db,
      minRankingAvailabilityBps,
      now,
    );
  }

  return {
    providers: providerCount,
    listings: listingTargets.size,
    targets: targetCount,
    scoringTargets: scoringTargets.length,
    checksRead: checkValues.length,
    checksInserted,
    skippedModels: [...skippedModels].sort(),
    failedProviders,
    failedProviderModels,
    minRankingAvailabilityBps,
  };
}
