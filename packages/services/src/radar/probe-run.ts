import { and, desc, eq, gte } from "@openstatus/db";
import {
  radarNotificationEvent,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarTargetStatus,
  selectRadarProbeRunSchema,
} from "@openstatus/db/src/schema";

import { requireScope } from "../auth";
import { type ServiceContext, withTransaction } from "../context";
import { NotFoundError } from "../errors";
import { hashSecret } from "./crypto";
import {
  decideRadarNotificationEvent,
  severityForRadarEvent,
  type RadarNotificationEventType,
} from "./notification-policy";
import { RecordRadarProbeRunInput } from "./schemas";

type TargetStatus =
  | "unknown"
  | "operational"
  | "degraded"
  | "down"
  | "paused"
  | "configuration_error";

function classifyStatus(args: {
  recentResults: Array<{
    success: boolean;
    errorType?: string | null;
    firstTokenMs?: number | null;
    totalLatencyMs?: number | null;
  }>;
  previousStatus?: TargetStatus;
}): TargetStatus {
  const latest = args.recentResults[0];

  if (!latest) return "unknown";

  if (!latest.success) {
    if (
      latest.errorType === "auth_error" ||
      latest.errorType === "insufficient_quota" ||
      latest.errorType === "model_not_found"
    ) {
      return "configuration_error";
    }

    const consecutiveFailures = countLeading(args.recentResults, (item) => {
      return !item.success;
    });
    return consecutiveFailures >= 3 ? "down" : "degraded";
  }

  if (
    (latest.firstTokenMs && latest.firstTokenMs > 15_000) ||
    (latest.totalLatencyMs && latest.totalLatencyMs > 30_000)
  ) {
    return "degraded";
  }

  return args.previousStatus === "down" ? "degraded" : "operational";
}

function countLeading<T>(items: T[], predicate: (item: T) => boolean) {
  let count = 0;

  for (const item of items) {
    if (!predicate(item)) break;
    count += 1;
  }

  return count;
}

export function hasConfirmedRecovery(
  recentResults: Array<{ success: boolean }>,
  requiredSuccesses = 3,
) {
  if (recentResults.length < requiredSuccesses) return false;

  return recentResults
    .slice(0, requiredSuccesses)
    .every((item) => item.success);
}

function percentile(values: number[], pct: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((pct / 100) * sorted.length) - 1,
  );
  return sorted[index] ?? null;
}

export async function recordRadarProbeRun(args: {
  ctx: ServiceContext;
  input: RecordRadarProbeRunInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = RecordRadarProbeRunInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const target = await tx
      .select()
      .from(radarProbeTarget)
      .where(
        and(
          eq(radarProbeTarget.id, input.targetId),
          eq(radarProbeTarget.workspaceId, ctx.workspace.id),
        ),
      )
      .get();
    if (!target) throw new NotFoundError("radar_probe_target", input.targetId);

    const run = await tx
      .insert(radarProbeRun)
      .values({
        workspaceId: ctx.workspace.id,
        poolId: target.poolId,
        targetId: target.id,
        providerId: target.providerId,
        credentialIdHash: target.credentialId
          ? await hashSecret(String(target.credentialId))
          : null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        success: input.success,
        httpStatus: input.httpStatus,
        errorType: input.errorType,
        safeErrorSummary: input.safeErrorSummary,
        ttfbMs: input.ttfbMs,
        firstTokenMs: input.firstTokenMs,
        totalLatencyMs: input.totalLatencyMs,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        tokensPerSecond: input.tokensPerSecond,
        estimatedCostMicros: input.estimatedCostMicros,
        responseSampleHash: input.responseSampleHash,
        traceId: input.traceId,
      })
      .returning()
      .get();

    const finishedAt = input.finishedAt ?? input.startedAt;
    const since24h = new Date(finishedAt.getTime() - 24 * 60 * 60 * 1000);
    const since1h = new Date(finishedAt.getTime() - 60 * 60 * 1000);
    const recent = await tx
      .select()
      .from(radarProbeRun)
      .where(
        and(
          eq(radarProbeRun.targetId, target.id),
          gte(radarProbeRun.startedAt, since24h),
        ),
      )
      .orderBy(desc(radarProbeRun.startedAt))
      .limit(2000)
      .all();

    const sampleCount24h = recent.length;
    const successCount24h = recent.filter((item) => item.success).length;
    const recent1h = recent.filter((item) => item.startedAt >= since1h);
    const sampleCount1h = recent1h.length;
    const successCount1h = recent1h.filter((item) => item.success).length;
    const firstTokens = recent
      .map((item) => item.firstTokenMs)
      .filter((value): value is number => typeof value === "number");
    const totalLatencies = recent
      .map((item) => item.totalLatencyMs)
      .filter((value): value is number => typeof value === "number");
    const existingStatus = await tx
      .select()
      .from(radarTargetStatus)
      .where(eq(radarTargetStatus.targetId, target.id))
      .get();

    const currentStatus = classifyStatus({
      recentResults: recent,
      previousStatus: existingStatus?.currentStatus as TargetStatus | undefined,
    });
    const latestNotificationEvent = await tx
      .select({
        id: radarNotificationEvent.id,
        eventType: radarNotificationEvent.eventType,
      })
      .from(radarNotificationEvent)
      .where(eq(radarNotificationEvent.targetId, target.id))
      .orderBy(
        desc(radarNotificationEvent.createdAt),
        desc(radarNotificationEvent.id),
      )
      .limit(1)
      .get();
    const errorCountByType: Record<string, number> = {};
    for (const item of recent) {
      if (!item.errorType) continue;
      errorCountByType[item.errorType] =
        (errorCountByType[item.errorType] ?? 0) + 1;
    }

    await tx
      .update(radarProbeTarget)
      .set({ currentStatus, updatedAt: new Date() })
      .where(eq(radarProbeTarget.id, target.id));

    const statusValues = {
      workspaceId: ctx.workspace.id,
      targetId: target.id,
      sampleCount1h,
      successRate1h:
        sampleCount1h > 0
          ? Math.round((successCount1h / sampleCount1h) * 10000)
          : 0,
      sampleCount24h,
      successRate24h:
        sampleCount24h > 0
          ? Math.round((successCount24h / sampleCount24h) * 10000)
          : 0,
      p50FirstTokenMs: percentile(firstTokens, 50),
      p95FirstTokenMs: percentile(firstTokens, 95),
      p50TotalLatencyMs: percentile(totalLatencies, 50),
      p95TotalLatencyMs: percentile(totalLatencies, 95),
      errorCountByType,
      lastCheckAt: finishedAt,
      lastSuccessAt: input.success ? finishedAt : existingStatus?.lastSuccessAt,
      lastFailureAt: input.success ? existingStatus?.lastFailureAt : finishedAt,
      currentStatus,
      updatedAt: new Date(),
    };

    if (existingStatus) {
      await tx
        .update(radarTargetStatus)
        .set(statusValues)
        .where(eq(radarTargetStatus.id, existingStatus.id));
    } else {
      await tx.insert(radarTargetStatus).values(statusValues);
    }

    const eventType = decideRadarNotificationEvent({
      previousStatus: existingStatus?.currentStatus as TargetStatus | undefined,
      currentStatus,
      latestEventType: latestNotificationEvent?.eventType as
        | RadarNotificationEventType
        | undefined,
      recoveryConfirmed: hasConfirmedRecovery(recent),
    });

    if (eventType) {
      const pool = await tx
        .select({
          id: radarPool.id,
          pageId: radarPool.pageId,
          name: radarPool.name,
        })
        .from(radarPool)
        .where(eq(radarPool.id, target.poolId))
        .get();

      if (pool?.pageId) {
        await tx.insert(radarNotificationEvent).values({
          workspaceId: ctx.workspace.id,
          poolId: target.poolId,
          targetId: target.id,
          pageId: pool.pageId,
          runId: run.id,
          eventType,
          severity: severityForRadarEvent(eventType),
          previousStatus: existingStatus?.currentStatus,
          currentStatus,
          title: buildNotificationTitle(eventType, target.displayName),
          message: buildNotificationMessage({
            targetDisplayName: target.displayName,
            modelName: target.modelName,
            currentStatus,
            successRate1h: statusValues.successRate1h,
            sampleCount1h: statusValues.sampleCount1h,
            p50FirstTokenMs: statusValues.p50FirstTokenMs,
            p95FirstTokenMs: statusValues.p95FirstTokenMs,
            safeErrorSummary: input.safeErrorSummary,
          }),
          dedupeKey: `radar:${target.id}:${run.id}:${eventType}`,
        });
      }
    }

    return selectRadarProbeRunSchema.parse(run);
  });
}

function buildNotificationTitle(
  eventType: RadarNotificationEventType,
  targetDisplayName: string,
) {
  switch (eventType) {
    case "degraded":
      return `Service degraded: ${targetDisplayName}`;
    case "down":
      return `Service down: ${targetDisplayName}`;
    case "configuration_error":
      return `Service configuration issue: ${targetDisplayName}`;
    case "recovered":
      return `Service recovered: ${targetDisplayName}`;
  }
}

function buildNotificationMessage(args: {
  targetDisplayName: string;
  modelName: string;
  currentStatus: TargetStatus;
  successRate1h: number;
  sampleCount1h: number;
  p50FirstTokenMs: number | null;
  p95FirstTokenMs: number | null;
  safeErrorSummary?: string;
}) {
  const lines = [
    `API key: ${args.targetDisplayName}`,
    `Probe model: ${args.modelName}`,
    `Current status: ${args.currentStatus}`,
    `1h availability: ${formatBasisPoints(args.successRate1h)} (${args.sampleCount1h} samples)`,
  ];

  if (args.p50FirstTokenMs !== null) {
    lines.push(`TTFT P50: ${formatDuration(args.p50FirstTokenMs)}`);
  }

  if (args.p95FirstTokenMs !== null) {
    lines.push(`TTFT P95: ${formatDuration(args.p95FirstTokenMs)}`);
  }

  if (args.safeErrorSummary) {
    lines.push(`Last error: ${args.safeErrorSummary}`);
  }

  return lines.join("\n");
}

function formatBasisPoints(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
