import { and, db, eq, inArray } from "@openstatus/db";
import {
  page,
  radarPool,
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
const MIN_SAMPLE_COUNT_24H = 10;
const API_VERSION = "v1";
const SCHEMA_VERSION = "2026-06-28";
const SCORE_VERSION = "radar-public-health-v1";
const CACHE_BUCKET_MS = 10 * 60 * 1000;
const CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=300";

type TargetStatus =
  | "unknown"
  | "operational"
  | "degraded"
  | "down"
  | "paused"
  | "configuration_error";

type PublicProviderStatus = "operational" | "degraded" | "down" | "unknown";
type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";
type Grade = "A" | "B" | "C" | "D" | "F" | "unknown";

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
  if (sampleCount >= MIN_SAMPLE_COUNT_24H) return "low";
  return "insufficient";
}

function gradeForScore(score: number | null): Grade {
  if (score === null) return "unknown";
  if (score >= 95) return "A";
  if (score >= 90) return "B";
  if (score >= 80) return "C";
  if (score >= 70) return "D";
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

function latencyPenalty(p95FirstTokenMs: number | null) {
  if (p95FirstTokenMs === null) return 0;
  if (p95FirstTokenMs > 15_000) return 20;
  if (p95FirstTokenMs > 8_000) return 10;
  if (p95FirstTokenMs > 5_000) return 5;
  return 0;
}

function statusPenalty(status: PublicProviderStatus) {
  if (status === "down") return 35;
  if (status === "degraded") return 10;
  if (status === "unknown") return 15;
  return 0;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, score));
}

function observedHealthScore(args: {
  availability24hBasisPoints: number | null;
  sampleCount24h: number;
  p95FirstTokenMs: number | null;
  status: PublicProviderStatus;
}) {
  if (
    args.availability24hBasisPoints === null ||
    args.sampleCount24h < MIN_SAMPLE_COUNT_24H
  ) {
    return null;
  }

  const availabilityScore = args.availability24hBasisPoints / 100;
  return clampScore(
    Math.round(
      availabilityScore -
        statusPenalty(args.status) -
        latencyPenalty(args.p95FirstTokenMs),
    ),
  );
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

async function buildPayload(inputSlugs: string[]) {
  const slugs = uniqueSlugs(inputSlugs);
  const generatedAt = new Date(
    Math.floor(Date.now() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS,
  );
  const windowFrom = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);

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

  const targetsByPoolId = new Map<number, typeof targetRows>();
  for (const target of targetRows) {
    const list = targetsByPoolId.get(target.poolId) ?? [];
    list.push(target);
    targetsByPoolId.set(target.poolId, list);
  }

  const itemsBySlug = new Map();
  for (const row of rows) {
    const targets = targetsByPoolId.get(row.poolId) ?? [];
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
    const lastCheckAt = latestDate(
      targets.map((target) => target.lastCheckAt ?? null),
    );
    const statusUpdatedAt = latestDate(
      targets.map((target) => target.statusUpdatedAt ?? null),
    );
    const confidenceLevel = confidenceForSampleCount(sampleCount24h);
    const score = observedHealthScore({
      availability24hBasisPoints,
      sampleCount24h,
      p95FirstTokenMs: p95FirstTokenSummaryMs,
      status,
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
        p95FirstTokenMs: p95FirstTokenSummaryMs,
        lastCheckAt,
        generatedAt,
      }),
      targetCount: targets.length,
      sampleCount24h,
      availability24hBasisPoints,
      p95FirstTokenSummaryMs,
      lastCheckAt: toIsoString(lastCheckAt),
      updatedAt: toIsoString(statusUpdatedAt ?? row.pageUpdatedAt ?? null),
      scoreVersion: SCORE_VERSION,
      scoreInputs: {
        minSampleCount24h: MIN_SAMPLE_COUNT_24H,
        availabilityWeight: 1,
        statusPenalty: statusPenalty(status),
        latencyPenalty: latencyPenalty(p95FirstTokenSummaryMs),
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
      label: "24h",
      from: windowFrom.toISOString(),
      to: generatedAt.toISOString(),
    },
    units: {
      availability: "basis_points",
      latency: "milliseconds",
      score: "0_to_100",
    },
    limit: MAX_SLUGS,
    items,
    missing: slugs.filter((slug) => !foundSlugs.has(slug)),
    disclaimer:
      "Observed health is based only on LLMHub Radar active probe samples. It is not an official SLA, model quality score, price ranking, or purchase recommendation.",
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

    const payload = await buildPayload(parsed.data.slugs);
    const body = JSON.stringify(payload);
    const etag = computeETag(body);

    if (isNotModified(request, etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          "Cache-Control": CACHE_CONTROL,
          ETag: etag,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("Error serving Radar provider query API:", error);
    return json({ error: "Internal Server Error" }, 500);
  }
}
