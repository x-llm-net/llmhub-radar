import {
  and,
  asc,
  db,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
} from "@openstatus/db";
import {
  radarCredential,
  radarPool,
  radarProbeTarget,
  radarProvider,
  radarTargetStatus,
  selectWorkspaceSchema,
  workspace,
} from "@openstatus/db/src/schema";

import { requireScope } from "../auth";
import type { DB, ServiceContext } from "../context";
import { PreconditionFailedError, NotFoundError } from "../errors";
import { withBusyRetry } from "../retry";
import { getRadarActorAccess } from "./access";
import { decryptSecret } from "./crypto";
import {
  getPriorityProbeConfig,
  runProbeWithOptionalRetry,
} from "./priority-probe";
import type { RadarProbeResult } from "./probe";
import { recordRadarProbeRun } from "./probe-run";
import { RecheckRadarCredentialInput } from "./schemas";

const DEFAULT_BATCH_SIZE = 1_200;
const DEFAULT_CONCURRENCY = 100;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;

type DueRadarTarget = NonNullable<
  Awaited<ReturnType<typeof getProbeableRadarTarget>>
>;

export type RunRadarCronResult = {
  selected: number;
  claimed: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ targetId: number; message: string }>;
};

export type RecheckRadarCredentialResult = {
  checkedAt: Date;
  recovered: boolean;
  errorType: string | null;
};

export async function runRadarCron(input?: {
  batchSize?: number;
  concurrency?: number;
  now?: Date;
}): Promise<RunRadarCronResult> {
  const now = input?.now ?? new Date();
  const batchSize =
    input?.batchSize ??
    positiveIntegerEnv("RADAR_PROBE_BATCH_SIZE", DEFAULT_BATCH_SIZE);
  const concurrency =
    input?.concurrency ??
    positiveIntegerEnv("RADAR_PROBE_CONCURRENCY", DEFAULT_CONCURRENCY);
  await retireExpiredRadarCredentialHandovers({ now });
  const recoveryTargets = await listDueRadarRecoveryTargets({
    now,
    limit: Math.min(batchSize, 5),
  });
  const dueTargets = [
    ...recoveryTargets,
    ...(await listDueRadarTargets({
      now,
      limit: Math.max(0, batchSize - recoveryTargets.length),
    })),
  ];

  const results = await runWithConcurrency(
    dueTargets,
    Math.max(1, concurrency),
    (target) =>
      runDueRadarTarget(target, now, {
        allowPausedCredential:
          target.credential.pauseReason === "insufficient_quota",
      }),
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

export async function recheckRadarCredential(args: {
  ctx: ServiceContext;
  input: RecheckRadarCredentialInput;
}): Promise<RecheckRadarCredentialResult> {
  requireScope(args.ctx, "write");
  const input = RecheckRadarCredentialInput.parse(args.input);
  const access = await getRadarActorAccess({ ctx: args.ctx, db });
  const now = new Date();
  const candidate = await db
    .select({
      target: radarProbeTarget,
      pool: radarPool,
      provider: radarProvider,
      credential: radarCredential,
      workspace,
    })
    .from(radarProbeTarget)
    .innerJoin(radarPool, eq(radarPool.id, radarProbeTarget.poolId))
    .innerJoin(radarProvider, eq(radarProvider.id, radarProbeTarget.providerId))
    .innerJoin(
      radarCredential,
      eq(radarCredential.id, radarProbeTarget.credentialId),
    )
    .innerJoin(workspace, eq(workspace.id, radarProbeTarget.workspaceId))
    .where(
      and(
        eq(radarPool.slug, input.poolSlug),
        isNull(radarPool.deletedAt),
        eq(radarCredential.id, input.credentialId),
        eq(radarCredential.enabled, true),
        eq(radarCredential.pauseReason, "insufficient_quota"),
        eq(radarProbeTarget.enabled, true),
        eq(radarProvider.enabled, true),
      ),
    )
    .orderBy(asc(radarProbeTarget.id))
    .get();

  if (
    !candidate ||
    (!access.isAdmin && candidate.pool.ownerUserId !== access.userId)
  ) {
    throw new NotFoundError("radar_credential", input.credentialId);
  }
  if (
    candidate.credential.handoverExpiresAt &&
    candidate.credential.handoverExpiresAt <= now
  ) {
    throw new PreconditionFailedError(
      "The platform credential handover has expired.",
    );
  }

  const result = await runDueRadarTarget(candidate, now, {
    allowPausedCredential: true,
  });
  if (result.status === "skipped") {
    throw new PreconditionFailedError(
      "A credential recovery check is already running.",
    );
  }
  if (result.status === "failed") {
    throw new PreconditionFailedError(result.message);
  }

  return {
    checkedAt: new Date(),
    recovered: result.probeSuccess,
    errorType: result.errorType ?? null,
  };
}

export async function retireExpiredRadarCredentialHandovers(input?: {
  now?: Date;
  db?: DB;
}) {
  const now = input?.now ?? new Date();
  const database = input?.db ?? db;
  const expiredCredentials = await database
    .select({ id: radarCredential.id })
    .from(radarCredential)
    .where(
      and(
        eq(radarCredential.enabled, true),
        lte(radarCredential.handoverExpiresAt, now),
      ),
    )
    .all();
  const credentialIds = expiredCredentials.map((credential) => credential.id);
  if (credentialIds.length === 0) return 0;

  const targets = await database
    .select({ id: radarProbeTarget.id })
    .from(radarProbeTarget)
    .where(inArray(radarProbeTarget.credentialId, credentialIds))
    .all();
  const targetIds = targets.map((target) => target.id);

  await database
    .update(radarCredential)
    .set({
      encryptedApiKey: "",
      keyFingerprint: "",
      lastFour: "",
      pauseReason: null,
      autoPausedAt: null,
      nextRecoveryCheckAt: null,
      enabled: false,
      updatedAt: now,
    })
    .where(inArray(radarCredential.id, credentialIds));

  if (targetIds.length > 0) {
    await Promise.all([
      database
        .update(radarProbeTarget)
        .set({
          currentStatus: "paused",
          nextCheckAt: null,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(inArray(radarProbeTarget.id, targetIds)),
      database
        .update(radarTargetStatus)
        .set({ currentStatus: "paused", updatedAt: now })
        .where(inArray(radarTargetStatus.targetId, targetIds)),
    ]);
  }

  return credentialIds.length;
}

async function listDueRadarTargets(args: { now: Date; limit: number }) {
  return db
    .select({
      target: radarProbeTarget,
      pool: radarPool,
      provider: radarProvider,
      credential: radarCredential,
      workspace,
    })
    .from(radarProbeTarget)
    .innerJoin(radarPool, eq(radarPool.id, radarProbeTarget.poolId))
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
        isNull(radarCredential.pauseReason),
        or(
          isNull(radarCredential.handoverExpiresAt),
          gt(radarCredential.handoverExpiresAt, args.now),
        ),
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
    .orderBy(asc(radarProbeTarget.nextCheckAt), asc(radarProbeTarget.id))
    .limit(args.limit)
    .all();
}

async function listDueRadarRecoveryTargets(args: { now: Date; limit: number }) {
  if (args.limit <= 0) return [];

  const rows = await db
    .select({
      target: radarProbeTarget,
      pool: radarPool,
      provider: radarProvider,
      credential: radarCredential,
      workspace,
    })
    .from(radarProbeTarget)
    .innerJoin(radarPool, eq(radarPool.id, radarProbeTarget.poolId))
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
        eq(radarCredential.pauseReason, "insufficient_quota"),
        lte(radarCredential.nextRecoveryCheckAt, args.now),
        or(
          isNull(radarCredential.handoverExpiresAt),
          gt(radarCredential.handoverExpiresAt, args.now),
        ),
        or(
          isNull(radarProbeTarget.lockedUntil),
          lte(radarProbeTarget.lockedUntil, args.now),
        ),
      ),
    )
    .orderBy(asc(radarCredential.nextRecoveryCheckAt), asc(radarProbeTarget.id))
    .limit(args.limit * 10)
    .all();

  const credentialIds = new Set<number>();
  return rows
    .filter((row) => {
      if (credentialIds.has(row.credential.id)) return false;
      credentialIds.add(row.credential.id);
      return true;
    })
    .slice(0, args.limit);
}

async function getProbeableRadarTarget(
  targetId: number,
  now: Date,
  allowPausedCredential = false,
) {
  return db
    .select({
      target: radarProbeTarget,
      pool: radarPool,
      provider: radarProvider,
      credential: radarCredential,
      workspace,
    })
    .from(radarProbeTarget)
    .innerJoin(radarPool, eq(radarPool.id, radarProbeTarget.poolId))
    .innerJoin(radarProvider, eq(radarProvider.id, radarProbeTarget.providerId))
    .innerJoin(
      radarCredential,
      eq(radarCredential.id, radarProbeTarget.credentialId),
    )
    .innerJoin(workspace, eq(workspace.id, radarProbeTarget.workspaceId))
    .where(
      and(
        eq(radarProbeTarget.id, targetId),
        eq(radarProbeTarget.enabled, true),
        eq(radarProvider.enabled, true),
        eq(radarCredential.enabled, true),
        allowPausedCredential
          ? eq(radarCredential.pauseReason, "insufficient_quota")
          : isNull(radarCredential.pauseReason),
        or(
          isNull(radarCredential.handoverExpiresAt),
          gt(radarCredential.handoverExpiresAt, now),
        ),
      ),
    )
    .get();
}

async function runDueRadarTarget(
  candidate: DueRadarTarget,
  now: Date,
  options?: { allowPausedCredential?: boolean },
): Promise<
  | {
      status: "success";
      targetId: number;
      probeSuccess: boolean;
      errorType?: string;
    }
  | { status: "failed"; targetId: number; message: string }
  | { status: "skipped"; targetId: number }
> {
  const startedAt = new Date();
  const leaseUntil = new Date(startedAt.getTime() + DEFAULT_LEASE_MS);
  const claimed = await claimRadarTarget({
    targetId: candidate.target.id,
    now,
    startedAt,
    leaseUntil,
  });

  if (!claimed) {
    return { status: "skipped", targetId: candidate.target.id };
  }

  const row = await getProbeableRadarTarget(
    candidate.target.id,
    new Date(),
    options?.allowPausedCredential,
  );
  if (!row) {
    await releaseRadarTargetLease(candidate.target.id);
    return { status: "skipped", targetId: candidate.target.id };
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
    return {
      status: "success",
      targetId: row.target.id,
      probeSuccess: result.success,
      errorType: result.errorType,
    };
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

async function releaseRadarTargetLease(targetId: number) {
  await withBusyRetry(() =>
    db
      .update(radarProbeTarget)
      .set({ lockedUntil: null, updatedAt: new Date() })
      .where(eq(radarProbeTarget.id, targetId))
      .run(),
  );
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

  const [providerBaseUrl, targetBaseUrlOverride, apiKey] = await Promise.all([
    decryptSecret(row.provider.baseUrlEncrypted),
    row.target.baseUrlOverrideEncrypted
      ? decryptSecret(row.target.baseUrlOverrideEncrypted)
      : Promise.resolve(null),
    decryptSecret(row.credential.encryptedApiKey),
  ]);

  const config = getPriorityProbeConfig(row.pool.slug);

  return runProbeWithOptionalRetry({
    baseUrl: targetBaseUrlOverride ?? providerBaseUrl,
    apiKey,
    model: row.target.modelName,
    stream: row.target.streamEnabled,
    timeoutMs: row.target.timeoutMs,
    maxTokens: row.target.maxTokens,
    retryAttempts: config.enabled ? config.retryAttempts : 0,
    retryBackoffMs: config.retryBackoffMs,
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
      .where(
        and(
          eq(radarProbeTarget.id, targetId),
          eq(radarProbeTarget.enabled, true),
          ne(radarProbeTarget.currentStatus, "paused"),
        ),
      )
      .run(),
  );
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
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
