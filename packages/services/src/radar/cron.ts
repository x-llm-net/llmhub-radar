import { and, db, eq, isNull, lte, or } from "@openstatus/db";
import {
  radarCredential,
  radarProbeTarget,
  radarProvider,
  selectWorkspaceSchema,
  workspace,
} from "@openstatus/db/src/schema";

import type { ServiceContext } from "../context";
import { withBusyRetry } from "../retry";
import { decryptSecret } from "./crypto";
import { runOpenAICompatibleProbe } from "./probe";
import type { RadarProbeResult } from "./probe";
import { recordRadarProbeRun } from "./probe-run";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;

type DueRadarTarget = Awaited<ReturnType<typeof listDueRadarTargets>>[number];

export type RunRadarCronResult = {
  selected: number;
  claimed: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ targetId: number; message: string }>;
};

export async function runRadarCron(input?: {
  batchSize?: number;
  concurrency?: number;
  now?: Date;
}): Promise<RunRadarCronResult> {
  const now = input?.now ?? new Date();
  const batchSize = input?.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = input?.concurrency ?? DEFAULT_CONCURRENCY;
  const dueTargets = await listDueRadarTargets({ now, limit: batchSize });

  const results = await runWithConcurrency(
    dueTargets,
    Math.max(1, concurrency),
    (target) => runDueRadarTarget(target, now),
  );

  const summary = results.reduce<RunRadarCronResult>(
    (summary, result) => {
      summary.selected += 1;

      if (result.status === "skipped") {
        summary.skipped += 1;
        return summary;
      }

      summary.claimed += 1;

      if (result.status === "success") {
        summary.success += 1;
      } else {
        summary.failed += 1;
        summary.errors.push({
          targetId: result.targetId,
          message: result.message,
        });
      }

      return summary;
    },
    {
      selected: 0,
      claimed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    },
  );

  return summary;
}

async function listDueRadarTargets(args: { now: Date; limit: number }) {
  return db
    .select({
      target: radarProbeTarget,
      provider: radarProvider,
      credential: radarCredential,
      workspace,
    })
    .from(radarProbeTarget)
    .innerJoin(radarProvider, eq(radarProvider.id, radarProbeTarget.providerId))
    .innerJoin(
      radarCredential,
      eq(radarCredential.id, radarProbeTarget.credentialId),
    )
    .innerJoin(workspace, eq(workspace.id, radarProbeTarget.workspaceId))
    .where(
      and(
        eq(radarProbeTarget.enabled, true),
        eq(radarProvider.enabled, true),
        eq(radarCredential.enabled, true),
        or(
          isNull(radarProbeTarget.nextCheckAt),
          lte(radarProbeTarget.nextCheckAt, args.now),
        ),
        or(
          isNull(radarProbeTarget.lockedUntil),
          lte(radarProbeTarget.lockedUntil, args.now),
        ),
      ),
    )
    .limit(args.limit)
    .all();
}

async function runDueRadarTarget(
  row: DueRadarTarget,
  now: Date,
): Promise<
  | { status: "success"; targetId: number }
  | { status: "failed"; targetId: number; message: string }
  | { status: "skipped"; targetId: number }
> {
  const startedAt = new Date();
  const leaseUntil = new Date(startedAt.getTime() + DEFAULT_LEASE_MS);
  const claimed = await claimRadarTarget({
    targetId: row.target.id,
    now,
    startedAt,
    leaseUntil,
  });

  if (!claimed) {
    return { status: "skipped", targetId: row.target.id };
  }

  const ctx: ServiceContext = {
    workspace: selectWorkspaceSchema.parse(row.workspace),
    actor: { type: "system", job: "radar-cron" },
  };

  try {
    const result = await probeTarget(row);
    const finishedAt = new Date();

    await recordRadarProbeRun({
      ctx,
      input: {
        targetId: row.target.id,
        startedAt,
        finishedAt,
        success: result.success,
        httpStatus: result.httpStatus,
        errorType: result.errorType,
        safeErrorSummary: result.safeErrorSummary,
        ttfbMs: result.ttfbMs,
        firstTokenMs: result.firstTokenMs,
        totalLatencyMs: result.totalLatencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        tokensPerSecond: calculateTokensPerSecond(result),
        responseSampleHash: result.responseSampleHash,
      },
    });

    await scheduleNextCheck(
      row.target.id,
      finishedAt,
      row.target.intervalSeconds,
    );
    return { status: "success", targetId: row.target.id };
  } catch (error) {
    const finishedAt = new Date();
    const message = toSafeErrorMessage(error);

    try {
      await recordRadarProbeRun({
        ctx,
        input: {
          targetId: row.target.id,
          startedAt,
          finishedAt,
          success: false,
          errorType: "unknown",
          safeErrorSummary: message,
          totalLatencyMs: Math.max(
            0,
            finishedAt.getTime() - startedAt.getTime(),
          ),
        },
      });
    } catch {
      // Keep the original operational error visible in the cron response.
    }

    await scheduleNextCheck(
      row.target.id,
      finishedAt,
      row.target.intervalSeconds,
    );
    return { status: "failed", targetId: row.target.id, message };
  }
}

async function claimRadarTarget(args: {
  targetId: number;
  now: Date;
  startedAt: Date;
  leaseUntil: Date;
}) {
  const claimed = await withBusyRetry(() =>
    db
      .update(radarProbeTarget)
      .set({
        lastCheckStartedAt: args.startedAt,
        lockedUntil: args.leaseUntil,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(radarProbeTarget.id, args.targetId),
          eq(radarProbeTarget.enabled, true),
          or(
            isNull(radarProbeTarget.nextCheckAt),
            lte(radarProbeTarget.nextCheckAt, args.now),
          ),
          or(
            isNull(radarProbeTarget.lockedUntil),
            lte(radarProbeTarget.lockedUntil, args.now),
          ),
        ),
      )
      .returning({ id: radarProbeTarget.id })
      .get(),
  );

  return Boolean(claimed);
}

async function probeTarget(row: DueRadarTarget): Promise<RadarProbeResult> {
  if (row.provider.providerType !== "openai_compatible") {
    return {
      success: false,
      errorType: "bad_response",
      totalLatencyMs: 0,
      safeErrorSummary: `Unsupported radar provider type: ${row.provider.providerType}`,
    };
  }

  const [baseUrl, apiKey] = await Promise.all([
    decryptSecret(row.provider.baseUrlEncrypted),
    decryptSecret(row.credential.encryptedApiKey),
  ]);

  return runOpenAICompatibleProbe({
    baseUrl,
    apiKey,
    model: row.target.modelName,
    stream: row.target.streamEnabled,
    timeoutMs: row.target.timeoutMs,
    maxTokens: row.target.maxTokens,
  });
}

async function scheduleNextCheck(
  targetId: number,
  finishedAt: Date,
  intervalSeconds: number,
) {
  const intervalMs = Math.max(60, intervalSeconds) * 1000;
  await withBusyRetry(() =>
    db
      .update(radarProbeTarget)
      .set({
        nextCheckAt: new Date(finishedAt.getTime() + intervalMs),
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(radarProbeTarget.id, targetId))
      .run(),
  );
}

function calculateTokensPerSecond(result: RadarProbeResult) {
  if (
    !result.tokensOut ||
    !result.totalLatencyMs ||
    result.totalLatencyMs <= 0
  ) {
    return undefined;
  }

  return Math.round((result.tokensOut / result.totalLatencyMs) * 1000);
}

function toSafeErrorMessage(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown radar probe error";
  return raw.replace(/\s+/g, " ").slice(0, 240);
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runNext(),
    ),
  );

  return results;
}
