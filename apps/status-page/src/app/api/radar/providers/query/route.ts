import { and, db, desc, eq, gte, inArray, isNull } from "@openstatus/db";
import {
  page,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarTargetStatus,
} from "@openstatus/db/src/schema";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getBaseUrl } from "@/lib/base-url";
import { computeETag, isNotModified } from "@/lib/http/etag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SLUGS = 20;
const MAX_BODY_BYTES = 8 * 1024;
const MIN_SAMPLE_COUNT_7D = 10;
const API_VERSION = "v1";
const SCHEMA_VERSION = "2026-06-29";
const SCORE_VERSION = "radar-public-availability-7d-v1";
const CACHE_BUCKET_MS = 10 * 60 * 1000;
const CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=300";
const MAX_CACHE_ENTRIES = 500;

type TargetStatus =
  | "unknown"
  | "operational"
  | "degraded"
  | "down"
  | "paused"
  | "configuration_error";

type PublicProviderStatus = "operational" | "degraded" | "down" | "unknown";
type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";
type Grade = "S" | "A" | "B" | "C" | "D" | "F" | "unknown";

type CacheEntry = {
  body: string;
  etag: string;
};

const responseCache = new Map<string, CacheEntry>();

const querySchema = z.object({
  slugs: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9-]+$/)
        .min(3)
        .max(80),
    )
    .min(1)
    .max(MAX_SLUGS),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
};

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function uniqueSlugs(slugs: string[]) {
  return Array.from(new Set(slugs.map((slug) => slug.trim().toLowerCase())));
}

function aggregateStatus(statuses: TargetStatus[]): PublicProviderStatus {
  const activeStatuses = statuses.filter((status) => status !== "paused");
  if (activeStatuses.length === 0) return "unknown";
  if (activeStatuses.every((status) => status === "unknown")) {
    return "unknown";
  }

  const allActiveTargetsDown = activeStatuses.every(
    (status) => status === "down" || status === "configuration_error",
  );
  if (allActiveTargetsDown) return "down";

  return activeStatuses.some((status) => status !== "operational")
    ? "degraded"
    : "operational";
}

function confidenceForSampleCount(sampleCount: number): ConfidenceLevel {
  if (sampleCount >= 120) return "high";
  if (sampleCount >= 30) return "medium";
  if (sampleCount >= MIN_SAMPLE_COUNT_7D) return "low";
  return "insufficient";
}

function gradeForScore(score: number | null): Grade {
  if (score === null) return "unknown";
  if (score >= 98) return "S";
  if (score >= 95) return "A";
  if (score >= 90) return "B";
  if (score >= 80) return "C";
  if (score >= 60) return "D";
  return "F";
}

function weightedAvailabilityBasisPoints(
  targets: Array<{ sampleCount24h: number; successRate24h: number }>,
) {
  const sampleCount = targets.reduce(
    (total, target) => total + target.sampleCount24h,
    0,
  );
  if (sampleCount === 0) return null;

  const weightedTotal = targets.reduce(
    (total, target) => total + target.successRate24h * target.sampleCount24h,
    0,
  );
  return Math.round(weightedTotal / sampleCount);
}

function weightedP95FirstTokenSummaryMs(
  targets: Array<{ sampleCount24h: number; p95FirstTokenMs: number | null }>,
) {
  const measuredTargets = targets.filter(
    (target): target is { sampleCount24h: number; p95FirstTokenMs: number } =>
      typeof target.p95FirstTokenMs === "number",
  );
  if (measuredTargets.length === 0) return null;

  const sampleCount = measuredTargets.reduce(
    (total, target) => total + target.sampleCount24h,
    0,
  );
  if (sampleCount === 0) {
    return Math.round(
      measuredTargets.reduce(
        (total, target) => total + target.p95FirstTokenMs,
        0,
      ) / measuredTargets.length,
    );
  }

  const weightedTotal = measuredTargets.reduce(
    (total, target) => total + target.p95FirstTokenMs * target.sampleCount24h,
    0,
  );
  return Math.round(weightedTotal / sampleCount);
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}

function availabilityBasisPoints(runs: Array<{ success: boolean }>) {
  if (runs.length === 0) return null;
  const successCount = runs.filter((run) => run.success).length;
  return Math.round((successCount / runs.length) * 10_000);
}

function scoreFromAvailability7d(args: {
  availability7dBasisPoints: number | null;
  sampleCount7d: number;
}) {
  if (
    args.availability7dBasisPoints === null ||
    args.sampleCount7d < MIN_SAMPLE_COUNT_7D
  ) {
    return null;
  }

  return Number((args.availability7dBasisPoints / 100).toFixed(2));
}

function buildQualityFlags(args: {
  status: PublicProviderStatus;
  confidenceLevel: ConfidenceLevel;
  p95FirstTokenMs: number | null;
  lastCheckAt: Date | null;
  generatedAt: Date;
}) {
  const flags: string[] = [];
  if (args.confidenceLevel === "insufficient") {
    flags.push("insufficient_samples");
  } else if (args.confidenceLevel === "low") {
    flags.push("low_sample_count");
  }
  if (args.status !== "operational") flags.push("current_issue");
  if (args.p95FirstTokenMs !== null && args.p95FirstTokenMs > 8_000) {
    flags.push("high_first_token_latency");
  }
  if (!args.lastCheckAt) {
    flags.push("never_checked");
  } else if (
    args.generatedAt.getTime() - args.lastCheckAt.getTime() >
    30 * 60 * 1000
  ) {
    flags.push("stale_data");
  }
  return flags;
}

function latestDate(values: Array<Date | null>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value > latest) return value;
    return latest;
  }, null);
}

function toIsoString(value: Date | null) {
  return value ? value.toISOString() : null;
}

function cacheKey(slugs: string[], generatedAt: Date) {
  return `${generatedAt.toISOString()}:${slugs.join(",")}`;
}

function rememberCacheEntry(key: string, entry: CacheEntry) {
  responseCache.set(key, entry);
  if (responseCache.size <= MAX_CACHE_ENTRIES) return;

  const oldestKey = responseCache.keys().next().value;
  if (oldestKey) responseCache.delete(oldestKey);
}

async function buildPayload(inputSlugs: string[], generatedAt: Date) {
  const slugs = uniqueSlugs(inputSlugs);
  const windowFrom7d = new Date(
    generatedAt.getTime() - 7 * 24 * 60 * 60 * 1000,
  );
  const windowFrom24h = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      pageId: page.id,
      title: page.title,
      description: page.description,
      slug: page.slug,
      defaultLocale: page.defaultLocale,
      customDomain: page.customDomain,
      icon: page.icon,
      pageUpdatedAt: page.updatedAt,
      poolId: radarPool.id,
      poolName: radarPool.name,
      poolDescription: radarPool.description,
    })
    .from(page)
    .innerJoin(radarPool, eq(radarPool.pageId, page.id))
    .where(
      and(
        inArray(page.slug, slugs),
        eq(page.published, true),
        eq(page.accessType, "public"),
        eq(radarPool.publicPoolOptIn, true),
        isNull(radarPool.deletedAt),
      ),
    )
    .all();

  const poolIds = rows.map((row) => row.poolId);
  const targetRows =
    poolIds.length > 0
      ? await db
          .select({
            poolId: radarProbeTarget.poolId,
            targetId: radarProbeTarget.id,
            targetStatus: radarProbeTarget.currentStatus,
            status: radarTargetStatus.currentStatus,
            sampleCount24h: radarTargetStatus.sampleCount24h,
            successRate24h: radarTargetStatus.successRate24h,
            p95FirstTokenMs: radarTargetStatus.p95FirstTokenMs,
            lastCheckAt: radarTargetStatus.lastCheckAt,
            statusUpdatedAt: radarTargetStatus.updatedAt,
          })
          .from(radarProbeTarget)
          .leftJoin(
            radarTargetStatus,
            eq(radarTargetStatus.targetId, radarProbeTarget.id),
          )
          .where(
            and(
              inArray(radarProbeTarget.poolId, poolIds),
              eq(radarProbeTarget.enabled, true),
            ),
          )
          .all()
      : [];
  const runRows =
    poolIds.length > 0
      ? await db
          .select({
            poolId: radarProbeRun.poolId,
            startedAt: radarProbeRun.startedAt,
            success: radarProbeRun.success,
            firstTokenMs: radarProbeRun.firstTokenMs,
            totalLatencyMs: radarProbeRun.totalLatencyMs,
          })
          .from(radarProbeRun)
          .where(
            and(
              inArray(radarProbeRun.poolId, poolIds),
              gte(radarProbeRun.startedAt, windowFrom7d),
            ),
          )
          .orderBy(desc(radarProbeRun.startedAt))
          .limit(50_000)
          .all()
      : [];

  const targetsByPoolId = new Map<number, typeof targetRows>();
  for (const target of targetRows) {
    const list = targetsByPoolId.get(target.poolId) ?? [];
    list.push(target);
    targetsByPoolId.set(target.poolId, list);
  }
  const runsByPoolId = new Map<number, typeof runRows>();
  for (const run of runRows) {
    const list = runsByPoolId.get(run.poolId) ?? [];
    list.push(run);
    runsByPoolId.set(run.poolId, list);
  }

  const itemsBySlug = new Map();
  for (const row of rows) {
    const targets = targetsByPoolId.get(row.poolId) ?? [];
    const runs = runsByPoolId.get(row.poolId) ?? [];
    const status = aggregateStatus(
      targets.map(
        (target) => target.status ?? target.targetStatus ?? "unknown",
      ),
    );
    const sampleCount24h = targets.reduce(
      (total, target) => total + (target.sampleCount24h ?? 0),
      0,
    );
    const availability24hBasisPoints = weightedAvailabilityBasisPoints(
      targets.map((target) => ({
        sampleCount24h: target.sampleCount24h ?? 0,
        successRate24h: target.successRate24h ?? 0,
      })),
    );
    const p95FirstTokenSummaryMs = weightedP95FirstTokenSummaryMs(
      targets.map((target) => ({
        sampleCount24h: target.sampleCount24h ?? 0,
        p95FirstTokenMs: target.p95FirstTokenMs ?? null,
      })),
    );
    const firstTokenValues7d = runs
      .map((run) => run.firstTokenMs)
      .filter((value): value is number => typeof value === "number");
    const availability7dBasisPoints = availabilityBasisPoints(runs);
    const p50FirstToken7dMs = percentile(firstTokenValues7d, 50);
    const p95FirstToken7dMs = percentile(firstTokenValues7d, 95);
    const lastCheckAt = latestDate(
      targets.map((target) => target.lastCheckAt ?? null),
    );
    const statusUpdatedAt = latestDate(
      targets.map((target) => target.statusUpdatedAt ?? null),
    );
    const sampleCount7d = runs.length;
    const confidenceLevel = confidenceForSampleCount(sampleCount7d);
    const score = scoreFromAvailability7d({
      availability7dBasisPoints,
      sampleCount7d,
    });

    itemsBySlug.set(row.slug, {
      slug: row.slug,
      name: row.title || row.poolName,
      description: row.description || row.poolDescription || "",
      icon: row.icon || null,
      statusPageUrl: getBaseUrl({
        slug: row.slug,
        customDomain: row.customDomain ?? undefined,
      }),
      status,
      observedHealthScore: score,
      grade: gradeForScore(score),
      confidenceLevel,
      qualityFlags: buildQualityFlags({
        status,
        confidenceLevel,
        p95FirstTokenMs: p95FirstToken7dMs ?? p95FirstTokenSummaryMs,
        lastCheckAt,
        generatedAt,
      }),
      targetCount: targets.length,
      sampleCount7d,
      availability7dBasisPoints,
      sampleCount24h,
      availability24hBasisPoints,
      p50FirstTokenMs: p50FirstToken7dMs,
      p95FirstTokenMs: p95FirstToken7dMs,
      p95FirstTokenSummaryMs,
      lastCheckAt: toIsoString(lastCheckAt),
      updatedAt: toIsoString(statusUpdatedAt ?? row.pageUpdatedAt ?? null),
      scoreVersion: SCORE_VERSION,
      scoreInputs: {
        minSampleCount7d: MIN_SAMPLE_COUNT_7D,
        scoreFormula: "observedHealthScore = availability7dBasisPoints / 100",
        latencyPenalty: 0,
      },
    });
  }

  const items = slugs
    .map((slug) => itemsBySlug.get(slug))
    .filter((item) => item !== undefined);
  const foundSlugs = new Set(items.map((item) => item.slug));

  return {
    apiVersion: API_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    window: {
      label: "7d",
      from: windowFrom7d.toISOString(),
      to: generatedAt.toISOString(),
    },
    windows: {
      primary: {
        label: "7d",
        from: windowFrom7d.toISOString(),
        to: generatedAt.toISOString(),
      },
      shortTerm: {
        label: "24h",
        from: windowFrom24h.toISOString(),
        to: generatedAt.toISOString(),
      },
    },
    units: {
      availability: "basis_points",
      latency: "milliseconds",
      score: "availability_percent",
    },
    limit: MAX_SLUGS,
    items,
    missing: slugs.filter((slug) => !foundSlugs.has(slug)),
    disclaimer:
      "Observed health score equals the 7-day observed probe availability percentage. It is not an official SLA, model quality score, price ranking, or purchase recommendation.",
  };
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "Request body too large" }, 413);
    }

    const jsonBody = await request.json().catch(() => null);
    const parsed = querySchema.safeParse(jsonBody);
    if (!parsed.success) {
      return json(
        {
          error: "Invalid request body",
          details: parsed.error.flatten(),
          limit: MAX_SLUGS,
        },
        400,
      );
    }

    const slugs = uniqueSlugs(parsed.data.slugs);
    const generatedAt = new Date(
      Math.floor(Date.now() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS,
    );
    const key = cacheKey(slugs, generatedAt);
    let entry = responseCache.get(key);
    if (!entry) {
      const payload = await buildPayload(slugs, generatedAt);
      const body = JSON.stringify(payload);
      entry = {
        body,
        etag: computeETag(body),
      };
      rememberCacheEntry(key, entry);
    }

    if (isNotModified(request, entry.etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          "Cache-Control": CACHE_CONTROL,
          ETag: entry.etag,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    return new NextResponse(entry.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
        ETag: entry.etag,
      },
    });
  } catch (error) {
    console.error("Error serving Radar provider query API:", error);
    return json({ error: "Internal Server Error" }, 500);
  }
}
