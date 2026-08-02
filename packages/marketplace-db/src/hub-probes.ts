import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
} from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  hubGroupBlocks,
  hubGroupModels,
  hubGroupModelStats,
  hubGroupSecrets,
  hubHealthBuckets3h,
  hubModels,
  hubProbeCycles,
  hubProbeRuns,
  hubProbeTargets,
  hubProviderGroups,
  hubProviders,
} from "./schema";
import {
  aggregateProbeSamples,
  BUCKET_MS,
  calculateRankingScoreBps,
  deriveCurrentStatus,
  floorToBucket,
  gradeAvailability,
  isQuotaProbeSample,
  MIN_BUCKET_COVERAGE_BPS,
  MIN_RANKING_SAMPLES,
  percentile,
  getQuotaPauseStartedAt,
  type ProbeOutcomeValue,
  type ProbeSample,
} from "./scoring";

type MarketplaceTx = Parameters<Parameters<MarketplaceDb["transaction"]>[0]>[0];

export type HubProbeResultInput = {
  success: boolean;
  httpStatus?: number;
  errorType?: string;
  ttfbMs?: number;
  firstTokenMs?: number;
  totalLatencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  safeErrorSummary?: string;
};

export type ClaimedHubProbe = {
  targetId: string;
  groupModelId: string;
  cycleId: string;
  leaseToken: string;
  scheduledAt: Date;
  timeoutMs: number;
  intervalSeconds: number;
  baseUrlCiphertext: string;
  baseUrlOverrideCiphertext: string | null;
  apiKeyCiphertext: string;
  upstreamModelName: string;
  configVersion: number;
  secretVersion: number;
  keyFingerprint: string;
  modelNotFoundCount: number;
};

const QUOTA_RECOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function claimDueHubProbes(
  db: MarketplaceDb,
  options: { workerId: string; limit?: number; now?: Date; leaseMs?: number },
): Promise<ClaimedHubProbe[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        targetId: hubProbeTargets.id,
        groupModelId: hubGroupModels.id,
        scheduledAt: hubProbeTargets.nextCheckAt,
        timeoutMs: hubProbeTargets.timeoutMs,
        intervalSeconds: hubProbeTargets.intervalSeconds,
        baseUrlCiphertext: hubProviderGroups.baseUrlCiphertext,
        baseUrlOverrideCiphertext: hubGroupModels.baseUrlOverrideCiphertext,
        apiKeyCiphertext: hubGroupSecrets.apiKeyCiphertext,
        upstreamModelName: hubGroupModels.upstreamModelName,
        configVersion: hubProviderGroups.configVersion,
        secretVersion: hubGroupSecrets.secretVersion,
        keyFingerprint: hubGroupSecrets.keyFingerprint,
        modelNotFoundCount: hubProbeTargets.modelNotFoundCount,
      })
      .from(hubProbeTargets)
      .innerJoin(
        hubGroupModels,
        eq(hubGroupModels.id, hubProbeTargets.groupModelId),
      )
      .innerJoin(
        hubProviderGroups,
        eq(hubProviderGroups.id, hubGroupModels.groupId),
      )
      .innerJoin(
        hubProviders,
        eq(hubProviders.id, hubProviderGroups.providerId),
      )
      .innerJoin(
        hubGroupSecrets,
        eq(hubGroupSecrets.groupId, hubProviderGroups.id),
      )
      .where(
        and(
          eq(hubProbeTargets.enabled, true),
          lte(hubProbeTargets.nextCheckAt, now),
          or(
            isNull(hubProbeTargets.lockedUntil),
            lt(hubProbeTargets.lockedUntil, now),
          ),
          eq(hubGroupModels.probeEnabled, true),
          eq(hubGroupModels.discoveryStatus, "active"),
          eq(hubProviderGroups.desiredStatus, "active"),
          inArray(hubProviderGroups.lifecycleStatus, ["verifying", "ready"]),
          eq(hubProviders.status, "active"),
          notExists(
            tx
              .select({ id: hubGroupBlocks.id })
              .from(hubGroupBlocks)
              .where(
                and(
                  eq(hubGroupBlocks.groupId, hubProviderGroups.id),
                  eq(hubGroupBlocks.stopsProbes, true),
                  isNull(hubGroupBlocks.resolvedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(hubProbeTargets.nextCheckAt))
      .limit(limit)
      .for("update", { of: hubProbeTargets, skipLocked: true });

    const claimed: ClaimedHubProbe[] = [];
    for (const row of rows) {
      const leaseToken = randomUUID();
      const leaseUntil = new Date(
        now.getTime() +
          (options.leaseMs ?? Math.max(60_000, row.timeoutMs + 30_000)),
      );
      const [existingCycle] = await tx
        .select({ id: hubProbeCycles.id })
        .from(hubProbeCycles)
        .where(
          and(
            eq(hubProbeCycles.targetId, row.targetId),
            eq(hubProbeCycles.scheduledAt, row.scheduledAt),
          ),
        )
        .limit(1);
      const cycleId = existingCycle?.id ?? randomUUID();
      await tx
        .update(hubProbeTargets)
        .set({
          leaseToken,
          lockedBy: options.workerId,
          lockedUntil: leaseUntil,
          updatedAt: now,
        })
        .where(eq(hubProbeTargets.id, row.targetId));
      if (existingCycle) {
        await tx
          .update(hubProbeCycles)
          .set({ status: "running", startedAt: now, updatedAt: now })
          .where(eq(hubProbeCycles.id, cycleId));
      } else {
        await tx.insert(hubProbeCycles).values({
          id: cycleId,
          targetId: row.targetId,
          scheduledAt: row.scheduledAt,
          status: "running",
          startedAt: now,
        });
      }
      claimed.push({ ...row, cycleId, leaseToken });
    }
    return claimed;
  });
}

export async function scheduleHubGroupProbeNow(
  db: MarketplaceDb,
  ownerWorkspaceId: string,
  groupId: string,
) {
  const now = new Date();
  const models = await db
    .select({ targetId: hubProbeTargets.id })
    .from(hubProbeTargets)
    .innerJoin(
      hubGroupModels,
      eq(hubGroupModels.id, hubProbeTargets.groupModelId),
    )
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(
      and(
        eq(hubProviderGroups.id, groupId),
        eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId),
        eq(hubGroupModels.discoveryStatus, "active"),
        eq(hubGroupModels.probeEnabled, true),
      ),
    );
  if (models.length === 0) return { scheduled: 0 };
  await db
    .update(hubProbeTargets)
    .set({ nextCheckAt: now, updatedAt: now })
    .where(
      inArray(
        hubProbeTargets.id,
        models.map((model) => model.targetId),
      ),
    );
  return { scheduled: models.length };
}

export async function completeHubProbe(
  db: MarketplaceDb,
  claim: ClaimedHubProbe,
  result: HubProbeResultInput,
  options: { startedAt?: Date; completedAt?: Date } = {},
) {
  const completedAt = options.completedAt ?? new Date();
  const startedAt =
    options.startedAt ??
    new Date(completedAt.getTime() - result.totalLatencyMs);
  const outcome = classifyHubProbeOutcome(result);

  await db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        id: hubProviderGroups.id,
        configVersion: hubProviderGroups.configVersion,
      })
      .from(hubGroupModels)
      .innerJoin(
        hubProviderGroups,
        eq(hubProviderGroups.id, hubGroupModels.groupId),
      )
      .where(eq(hubGroupModels.id, claim.groupModelId))
      .limit(1)
      .for("update", { of: hubProviderGroups });
    if (!group) throw new Error("Probe group no longer exists");
    const [secret] = await tx
      .select({ secretVersion: hubGroupSecrets.secretVersion })
      .from(hubGroupSecrets)
      .where(eq(hubGroupSecrets.groupId, group.id))
      .limit(1)
      .for("update");
    const [lease] = await tx
      .select({ leaseToken: hubProbeTargets.leaseToken })
      .from(hubProbeTargets)
      .where(eq(hubProbeTargets.id, claim.targetId))
      .limit(1)
      .for("update");
    if (lease?.leaseToken !== claim.leaseToken) {
      throw new Error("Probe lease is no longer owned by this worker");
    }

    await tx.insert(hubProbeRuns).values({
      targetId: claim.targetId,
      groupModelId: claim.groupModelId,
      probeCycleId: claim.cycleId,
      attemptNo: 0,
      outcome,
      httpStatus: result.httpStatus,
      errorCode: result.errorType,
      safeErrorSummary: result.safeErrorSummary,
      ttfbMs: result.ttfbMs,
      firstTokenMs: result.firstTokenMs,
      totalLatencyMs: result.totalLatencyMs,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      configVersion: claim.configVersion,
      secretVersion: claim.secretVersion,
      keyFingerprint: claim.keyFingerprint,
      scheduledAt: claim.scheduledAt,
      startedAt,
      completedAt,
    });
    await tx
      .update(hubProbeCycles)
      .set({
        status: "completed",
        finishedAt: completedAt,
        updatedAt: completedAt,
      })
      .where(eq(hubProbeCycles.id, claim.cycleId));
    await tx
      .update(hubProbeTargets)
      .set({
        leaseToken: null,
        lockedBy: null,
        lockedUntil: null,
        lastCheckAt: completedAt,
        modelNotFoundCount:
          result.errorType === "model_not_found"
            ? claim.modelNotFoundCount + 1
            : 0,
        updatedAt: completedAt,
      })
      .where(eq(hubProbeTargets.id, claim.targetId));

    const currentConfig =
      group.configVersion === claim.configVersion &&
      secret?.secretVersion === claim.secretVersion;
    const quotaPaused =
      currentConfig && result.errorType === "insufficient_quota";
    await tx
      .update(hubProbeTargets)
      .set({
        nextCheckAt: currentConfig
          ? new Date(
              completedAt.getTime() +
                (quotaPaused
                  ? QUOTA_RECOVERY_INTERVAL_MS
                  : claim.intervalSeconds * 1000),
            )
          : completedAt,
      })
      .where(eq(hubProbeTargets.id, claim.targetId));
    if (quotaPaused) {
      await tx
        .update(hubProbeTargets)
        .set({
          nextCheckAt: new Date(
            completedAt.getTime() + QUOTA_RECOVERY_INTERVAL_MS,
          ),
          updatedAt: completedAt,
        })
        .where(
          inArray(
            hubProbeTargets.groupModelId,
            tx
              .select({ id: hubGroupModels.id })
              .from(hubGroupModels)
              .where(eq(hubGroupModels.groupId, group.id)),
          ),
        );
      await tx
        .insert(hubGroupBlocks)
        .values({
          groupId: group.id,
          source: "balance",
          reasonCode: "insufficient_quota",
          stopsTraffic: true,
          stopsProbes: false,
          autoClear: true,
          details: { detectedBy: "probe", targetId: claim.targetId },
          createdAt: completedAt,
        })
        .onConflictDoNothing();
    } else if (currentConfig && result.success) {
      const [quotaBlock] = await tx
        .select({ id: hubGroupBlocks.id, details: hubGroupBlocks.details })
        .from(hubGroupBlocks)
        .where(
          and(
            eq(hubGroupBlocks.groupId, group.id),
            eq(hubGroupBlocks.source, "balance"),
            eq(hubGroupBlocks.reasonCode, "insufficient_quota"),
            eq(hubGroupBlocks.autoClear, true),
            isNull(hubGroupBlocks.resolvedAt),
          ),
        )
        .limit(1);
      const recoveryTargetId = quotaBlock?.details?.targetId;
      if (quotaBlock && recoveryTargetId === claim.targetId) {
        await tx
          .update(hubGroupBlocks)
          .set({ resolvedAt: completedAt })
          .where(eq(hubGroupBlocks.id, quotaBlock.id));
      }
    }
    if (currentConfig) {
      await refreshHubGroupModelStats(
        tx,
        claim.groupModelId,
        completedAt,
        claim.configVersion,
      );
    }
    if (result.success && currentConfig) {
      await tx
        .update(hubProviderGroups)
        .set({ lifecycleStatus: "ready", updatedAt: completedAt })
        .where(
          and(
            eq(
              hubProviderGroups.id,
              tx
                .select({ groupId: hubGroupModels.groupId })
                .from(hubGroupModels)
                .where(eq(hubGroupModels.id, claim.groupModelId)),
            ),
            eq(hubProviderGroups.lifecycleStatus, "verifying"),
            eq(hubProviderGroups.configVersion, claim.configVersion),
          ),
        );
    }
  });
}

export async function failHubProbeLease(
  db: MarketplaceDb,
  claim: ClaimedHubProbe,
  error: unknown,
) {
  const completedAt = new Date();
  const safeSummary =
    error instanceof Error ? error.message.slice(0, 240) : "Worker failure";
  await completeHubProbe(
    db,
    claim,
    {
      success: false,
      errorType: "observer_error",
      safeErrorSummary: safeSummary,
      totalLatencyMs: 0,
    },
    { completedAt },
  );
}

export async function refreshHubGroupModelStats(
  tx: MarketplaceTx,
  groupModelId: string,
  asOf = new Date(),
  configVersion?: number,
) {
  const windowStart = new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [target] = await tx
    .select({
      intervalSeconds: hubProbeTargets.intervalSeconds,
      createdAt: hubProbeTargets.createdAt,
    })
    .from(hubProbeTargets)
    .where(eq(hubProbeTargets.groupModelId, groupModelId))
    .limit(1);
  if (!target) throw new Error("Probe target not found");

  const runs = await tx
    .select({
      attemptNo: hubProbeRuns.attemptNo,
      outcome: hubProbeRuns.outcome,
      scheduledAt: hubProbeRuns.scheduledAt,
      errorCode: hubProbeRuns.errorCode,
      safeErrorSummary: hubProbeRuns.safeErrorSummary,
      firstTokenMs: hubProbeRuns.firstTokenMs,
    })
    .from(hubProbeRuns)
    .where(
      and(
        eq(hubProbeRuns.groupModelId, groupModelId),
        configVersion === undefined
          ? undefined
          : eq(hubProbeRuns.configVersion, configVersion),
        gte(hubProbeRuns.scheduledAt, windowStart),
        lte(hubProbeRuns.scheduledAt, asOf),
      ),
    )
    .orderBy(desc(hubProbeRuns.scheduledAt));
  const samples: ProbeSample[] = runs.map((run) => ({ ...run }));
  const bucketStart = floorToBucket(asOf);
  const affectedBucket = floorToBucket(samples[0]?.scheduledAt ?? asOf);
  const bucketEnd = new Date(affectedBucket.getTime() + BUCKET_MS);
  const expectedCount = Math.max(
    1,
    Math.floor(BUCKET_MS / (target.intervalSeconds * 1000)),
  );
  const bucket = aggregateProbeSamples(
    affectedBucket,
    expectedCount,
    samples.filter(
      (sample) =>
        sample.scheduledAt >= affectedBucket && sample.scheduledAt < bucketEnd,
    ),
  );
  await tx
    .insert(hubHealthBuckets3h)
    .values({ groupModelId, ...bucket })
    .onConflictDoUpdate({
      target: [hubHealthBuckets3h.groupModelId, hubHealthBuckets3h.bucketStart],
      set: { ...bucket, updatedAt: asOf },
    });

  const scoreable = samples.filter(
    (sample) => sample.attemptNo === 0 && !isQuotaProbeSample(sample),
  );
  const successes = scoreable.filter((sample) => sample.outcome === "success");
  const providerFailures = scoreable.filter(
    (sample) => sample.outcome === "provider_failure",
  );
  const sampleCount = successes.length + providerFailures.length;
  const availabilityBps =
    sampleCount === 0
      ? null
      : Math.round((successes.length / sampleCount) * 10_000);
  const quotaPauseStartedAt = getQuotaPauseStartedAt(samples);
  const currentStatus = deriveCurrentStatus(
    quotaPauseStartedAt
      ? samples.filter((sample) => !isQuotaProbeSample(sample))
      : samples,
    asOf,
    Math.max(30 * 60 * 1000, target.intervalSeconds * 3 * 1000),
  );
  const firstTokenValues = successes
    .map((sample) => sample.firstTokenMs)
    .filter((value): value is number => value !== null && value !== undefined);
  const firstTokenP50Ms = percentile(firstTokenValues, 50);
  const firstTokenP95Ms = percentile(firstTokenValues, 95);
  const buckets = await tx
    .select()
    .from(hubHealthBuckets3h)
    .where(
      and(
        eq(hubHealthBuckets3h.groupModelId, groupModelId),
        gte(hubHealthBuckets3h.bucketStart, floorToBucket(windowStart)),
        lte(hubHealthBuckets3h.bucketStart, bucketStart),
      ),
    );
  const validBucketCount = buckets.filter(
    (item) => item.coverageBps >= MIN_BUCKET_COVERAGE_BPS,
  ).length;
  const coverageExpected = Math.max(
    sampleCount,
    Math.floor(
      (asOf.getTime() -
        Math.max(windowStart.getTime(), target.createdAt.getTime())) /
        (target.intervalSeconds * 1000),
    ),
  );
  const coverageBps =
    coverageExpected === 0
      ? 0
      : Math.min(10_000, Math.round((sampleCount / coverageExpected) * 10_000));
  let eligibilityReason: string | null = null;
  if (sampleCount === 0) eligibilityReason = "no_scoreable_samples";
  else if (sampleCount < MIN_RANKING_SAMPLES)
    eligibilityReason = "insufficient_samples";
  else if (currentStatus === "configuration_error" && !quotaPauseStartedAt)
    eligibilityReason = "configuration_error";
  else if (
    (currentStatus === "unknown" || currentStatus === "stale") &&
    !quotaPauseStartedAt
  )
    eligibilityReason = "stale";
  const eligible = eligibilityReason === null;
  const rankingScoreBps = eligible
    ? calculateRankingScoreBps({
        availabilityBps,
        firstTokenP50Ms,
        firstTokenP95Ms,
        sampleCount,
        validBucketCount,
      })
    : null;

  await tx
    .insert(hubGroupModelStats)
    .values({
      groupModelId,
      windowStart,
      windowEnd: asOf,
      availabilityBps,
      coverageBps,
      grade:
        eligible && availabilityBps !== null
          ? gradeAvailability(availabilityBps)
          : null,
      firstTokenP50Ms,
      firstTokenP95Ms,
      sampleCount,
      validBucketCount,
      rankingScoreBps,
      currentStatus,
      eligible,
      eligibilityReason,
      lastCheckAt: samples[0]?.scheduledAt ?? null,
      lastSuccessAt: successes[0]?.scheduledAt ?? null,
      lastFailureAt: scoreable.find((sample) => sample.outcome !== "success")
        ?.scheduledAt,
      updatedAt: asOf,
    })
    .onConflictDoUpdate({
      target: hubGroupModelStats.groupModelId,
      set: {
        windowStart,
        windowEnd: asOf,
        availabilityBps,
        coverageBps,
        grade:
          eligible && availabilityBps !== null
            ? gradeAvailability(availabilityBps)
            : null,
        firstTokenP50Ms,
        firstTokenP95Ms,
        sampleCount,
        validBucketCount,
        rankingScoreBps,
        currentStatus,
        eligible,
        eligibilityReason,
        lastCheckAt: samples[0]?.scheduledAt ?? null,
        lastSuccessAt: successes[0]?.scheduledAt ?? null,
        lastFailureAt: scoreable.find((sample) => sample.outcome !== "success")
          ?.scheduledAt,
        updatedAt: asOf,
      },
    });
}

export async function listHubGroupProbeRuns(
  db: MarketplaceDb,
  ownerWorkspaceId: string,
  groupId: string,
  limit = 30,
) {
  return db
    .select({
      cycleId: hubProbeRuns.probeCycleId,
      groupModelId: hubProbeRuns.groupModelId,
      modelName: hubModels.displayName,
      upstreamModelName: hubGroupModels.upstreamModelName,
      outcome: hubProbeRuns.outcome,
      httpStatus: hubProbeRuns.httpStatus,
      errorCode: hubProbeRuns.errorCode,
      safeErrorSummary: hubProbeRuns.safeErrorSummary,
      firstTokenMs: hubProbeRuns.firstTokenMs,
      totalLatencyMs: hubProbeRuns.totalLatencyMs,
      scheduledAt: hubProbeRuns.scheduledAt,
      completedAt: hubProbeRuns.completedAt,
    })
    .from(hubProbeRuns)
    .innerJoin(hubGroupModels, eq(hubGroupModels.id, hubProbeRuns.groupModelId))
    .innerJoin(hubModels, eq(hubModels.id, hubGroupModels.modelId))
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(
      and(
        eq(hubProviderGroups.id, groupId),
        eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId),
      ),
    )
    .orderBy(desc(hubProbeRuns.scheduledAt))
    .limit(Math.max(1, Math.min(limit, 100)));
}

export function classifyHubProbeOutcome(
  result: HubProbeResultInput,
): ProbeOutcomeValue {
  if (result.success) return "success";
  if (result.errorType === "observer_error") return "observer_error";
  if (
    result.errorType === "auth_error" ||
    result.errorType === "model_not_found" ||
    result.errorType === "insufficient_quota"
  ) {
    return "configuration_error";
  }
  return "provider_failure";
}
