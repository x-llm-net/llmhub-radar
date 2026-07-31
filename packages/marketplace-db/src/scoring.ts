export const BUCKET_HOURS = 3;
export const BUCKET_COUNT = 56;
export const BUCKET_MS = BUCKET_HOURS * 60 * 60 * 1000;
export const WINDOW_MS = BUCKET_COUNT * BUCKET_MS;
export const MIN_VALID_BUCKETS = 52;
export const MIN_BUCKET_COVERAGE_BPS = 8_000;
export const MIN_WINDOW_COVERAGE_BPS = 9_500;
export const MIN_RANKING_SAMPLES = 4;
export const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;
export const DEFAULT_SLOW_FIRST_TOKEN_MS = 15_000;
export const DEFAULT_MIN_RANKING_AVAILABILITY_BPS = 0;
export const RANKING_P50_ZERO_MS = 10_000;
export const RANKING_P95_ZERO_MS = 20_000;
export const RANKING_SAMPLE_FULL_COUNT = 700;
export const RANKING_CONFIDENCE_FLOOR_BPS = 6_000;
export const RANKING_CONFIDENCE_RANGE_BPS = 4_000;
export const RANKING_PAUSE_PENALTY_MAX_BPS = 1_000;
export const RANKING_PAUSE_PENALTY_FULL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type ProbeOutcomeValue =
  | "success"
  | "provider_failure"
  | "configuration_error"
  | "observer_error";

export type CurrentStatusValue =
  | "unknown"
  | "normal"
  | "degraded"
  | "down"
  | "configuration_error"
  | "stale";

export type AvailabilityGradeValue = "S" | "A" | "B" | "C" | "D";

export interface ProbeSample {
  attemptNo: number;
  outcome: ProbeOutcomeValue;
  scheduledAt: Date;
  errorCode?: string | null;
  safeErrorSummary?: string | null;
  firstTokenMs?: number | null;
}

export interface HealthBucketInput {
  bucketStart: Date;
  expectedCount: number;
  attemptedCount: number;
  successCount: number;
  providerFailureCount: number;
  configurationErrorCount: number;
  observerErrorCount: number;
  slowSuccessCount: number;
  availabilityBps: number | null;
  coverageBps: number;
  lastCheckAt: Date | null;
}

export interface SevenDayStats {
  windowStart: Date;
  windowEnd: Date;
  expectedCount: number;
  successCount: number;
  providerFailureCount: number;
  sampleCount: number;
  availabilityBps: number | null;
  coverageBps: number;
  grade: AvailabilityGradeValue | null;
  currentStatus: CurrentStatusValue;
  eligible: boolean;
  eligibilityReason: string | null;
  validBucketCount: number;
  lastCheckAt: Date | null;
}

function ratioToBps(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.min(10_000, Math.round((numerator / denominator) * 10_000));
}

export function hasInsufficientQuotaSignal(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  const quotaSignals = [
    "insufficient_quota",
    "insufficient quota",
    "quota exceeded",
    "exceeded your current quota",
    "insufficient_balance",
    "billing",
    "insufficient balance",
    "insufficient account balance",
    "account balance insufficient",
    "not enough balance",
    "no balance",
    "balance is 0",
    "balance exhausted",
    "insufficient credit",
    "not enough credit",
    "no credit",
    "credits exhausted",
    "recharge",
    "top up",
    "\u4f59\u989d\u4e0d\u8db3",
    "\u4f59\u989d\u4e3a0",
    "\u4f59\u989d\u4e3a 0",
    "\u53ef\u7528\u4f59\u989d",
    "\u989d\u5ea6\u4e0d\u8db3",
    "\u6b20\u8d39",
    "\u5145\u503c",
  ];

  return quotaSignals.some((signal) => text.includes(signal));
}

export function isQuotaProbeSample(sample: {
  errorCode?: string | null;
  safeErrorSummary?: string | null;
}) {
  return (
    hasInsufficientQuotaSignal(sample.errorCode) ||
    hasInsufficientQuotaSignal(sample.safeErrorSummary)
  );
}

export function floorToBucket(value: Date) {
  return new Date(Math.floor(value.getTime() / BUCKET_MS) * BUCKET_MS);
}

export function getCompletedWindow(asOf: Date) {
  const windowEnd = floorToBucket(asOf);
  const windowStart = new Date(windowEnd.getTime() - WINDOW_MS);
  return { windowStart, windowEnd };
}

export function gradeAvailability(
  availabilityBps: number,
): AvailabilityGradeValue {
  if (availabilityBps >= 9_800) return "S";
  if (availabilityBps >= 9_500) return "A";
  if (availabilityBps >= 9_000) return "B";
  if (availabilityBps >= 8_000) return "C";
  return "D";
}

export function percentile(values: number[], percentileValue: number) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[index] as number);
}

export function linearLatencyScoreBps(
  latencyMs: number | null | undefined,
  zeroAtMs: number,
) {
  if (latencyMs === null || latencyMs === undefined) return 0;
  if (!Number.isFinite(latencyMs) || zeroAtMs <= 0) return 0;
  return Math.max(
    0,
    Math.min(10_000, Math.round(((zeroAtMs - latencyMs) / zeroAtMs) * 10_000)),
  );
}

export function confidenceScoreBps(args: {
  sampleCount: number;
  validBucketCount: number;
}) {
  const sampleScore = Math.min(
    10_000,
    Math.round((args.sampleCount / RANKING_SAMPLE_FULL_COUNT) * 10_000),
  );
  const bucketScore = Math.min(
    10_000,
    Math.round((args.validBucketCount / BUCKET_COUNT) * 10_000),
  );
  const rawConfidenceScore = Math.round(sampleScore * 0.4 + bucketScore * 0.6);
  return (
    RANKING_CONFIDENCE_FLOOR_BPS +
    Math.round((rawConfidenceScore / 10_000) * RANKING_CONFIDENCE_RANGE_BPS)
  );
}

export function calculateRankingScoreBps(args: {
  availabilityBps: number | null;
  firstTokenP50Ms: number | null;
  firstTokenP95Ms: number | null;
  sampleCount: number;
  validBucketCount: number;
  pausePenaltyBps?: number;
}) {
  const availabilityScore = args.availabilityBps ?? 0;
  const p50Score = linearLatencyScoreBps(
    args.firstTokenP50Ms,
    RANKING_P50_ZERO_MS,
  );
  const p95Score = linearLatencyScoreBps(
    args.firstTokenP95Ms,
    RANKING_P95_ZERO_MS,
  );
  const confidenceScore = confidenceScoreBps({
    sampleCount: args.sampleCount,
    validBucketCount: args.validBucketCount,
  });

  const rawScore = Math.round(
    availabilityScore * 0.8 +
      p50Score * 0.1 +
      p95Score * 0.05 +
      confidenceScore * 0.05,
  );
  return Math.max(0, rawScore - Math.max(0, args.pausePenaltyBps ?? 0));
}

export function quotaPausePenaltyBps(pausedSince: Date | null, asOf: Date) {
  if (!pausedSince || pausedSince > asOf) return 0;
  return Math.min(
    RANKING_PAUSE_PENALTY_MAX_BPS,
    Math.round(
      ((asOf.getTime() - pausedSince.getTime()) /
        RANKING_PAUSE_PENALTY_FULL_AFTER_MS) *
        RANKING_PAUSE_PENALTY_MAX_BPS,
    ),
  );
}

export function aggregateProbeSamples(
  bucketStart: Date,
  expectedCount: number,
  samples: ProbeSample[],
  slowFirstTokenMs = DEFAULT_SLOW_FIRST_TOKEN_MS,
): HealthBucketInput {
  const primarySamples = samples.filter(
    (sample) => sample.attemptNo === 0 && !isQuotaProbeSample(sample),
  );
  let successCount = 0;
  let providerFailureCount = 0;
  let configurationErrorCount = 0;
  let observerErrorCount = 0;
  let slowSuccessCount = 0;
  let lastCheckAt: Date | null = null;

  for (const sample of primarySamples) {
    if (!lastCheckAt || sample.scheduledAt > lastCheckAt) {
      lastCheckAt = sample.scheduledAt;
    }

    switch (sample.outcome) {
      case "success":
        successCount += 1;
        if (
          sample.firstTokenMs !== null &&
          sample.firstTokenMs !== undefined &&
          sample.firstTokenMs > slowFirstTokenMs
        ) {
          slowSuccessCount += 1;
        }
        break;
      case "provider_failure":
        providerFailureCount += 1;
        break;
      case "configuration_error":
        configurationErrorCount += 1;
        break;
      case "observer_error":
        observerErrorCount += 1;
        break;
    }
  }

  const sampleCount = successCount + providerFailureCount;

  return {
    bucketStart,
    expectedCount,
    attemptedCount: primarySamples.length,
    successCount,
    providerFailureCount,
    configurationErrorCount,
    observerErrorCount,
    slowSuccessCount,
    availabilityBps:
      sampleCount === 0 ? null : ratioToBps(successCount, sampleCount),
    coverageBps: ratioToBps(sampleCount, expectedCount),
    lastCheckAt,
  };
}

export function deriveCurrentStatus(
  samples: ProbeSample[],
  asOf: Date,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): CurrentStatusValue {
  const primarySamples = samples
    .filter((sample) => sample.attemptNo === 0)
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  const latest = primarySamples[0];

  if (!latest) return "unknown";
  if (asOf.getTime() - latest.scheduledAt.getTime() > staleAfterMs) {
    return "stale";
  }
  if (latest.outcome === "configuration_error") return "configuration_error";
  if (latest.outcome === "observer_error") return "stale";
  if (latest.outcome === "success") return "normal";

  const latestThree = primarySamples.slice(0, 3);
  return latestThree.length === 3 &&
    latestThree.every((sample) => sample.outcome === "provider_failure")
    ? "down"
    : "degraded";
}

export function getQuotaPauseStartedAt(samples: ProbeSample[]) {
  const primarySamples = samples
    .filter((sample) => sample.attemptNo === 0)
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  if (!primarySamples[0] || !isQuotaProbeSample(primarySamples[0])) {
    return null;
  }

  let pausedSince = primarySamples[0].scheduledAt;
  for (const sample of primarySamples) {
    if (!isQuotaProbeSample(sample)) break;
    pausedSince = sample.scheduledAt;
  }
  return pausedSince;
}

export function calculateSevenDayStats(
  buckets: HealthBucketInput[],
  asOf: Date,
  currentStatus: CurrentStatusValue,
  _observationStartedAt?: Date,
  _minRankingAvailabilityBps = DEFAULT_MIN_RANKING_AVAILABILITY_BPS,
  quotaPaused = false,
): SevenDayStats {
  const { windowStart, windowEnd } = getCompletedWindow(asOf);
  const windowBuckets = buckets.filter(
    (bucket) =>
      bucket.bucketStart >= windowStart && bucket.bucketStart < windowEnd,
  );
  const expectedCount = windowBuckets.reduce(
    (total, bucket) => total + bucket.expectedCount,
    0,
  );
  const successCount = windowBuckets.reduce(
    (total, bucket) => total + bucket.successCount,
    0,
  );
  const providerFailureCount = windowBuckets.reduce(
    (total, bucket) => total + bucket.providerFailureCount,
    0,
  );
  const sampleCount = successCount + providerFailureCount;
  const coverageBps = ratioToBps(sampleCount, expectedCount);
  const availabilityBps =
    sampleCount === 0 ? null : ratioToBps(successCount, sampleCount);
  const validBucketCount = windowBuckets.filter(
    (bucket) =>
      bucket.expectedCount > 0 && bucket.coverageBps >= MIN_BUCKET_COVERAGE_BPS,
  ).length;
  const lastCheckAt = windowBuckets.reduce<Date | null>(
    (latest, bucket) =>
      !latest || (bucket.lastCheckAt && bucket.lastCheckAt > latest)
        ? bucket.lastCheckAt
        : latest,
    null,
  );

  let eligibilityReason: string | null = null;
  if (availabilityBps === null) {
    eligibilityReason = "no_scoreable_samples";
  } else if (sampleCount < MIN_RANKING_SAMPLES) {
    eligibilityReason = "insufficient_samples";
  } else if (currentStatus === "configuration_error" && !quotaPaused) {
    eligibilityReason = "configuration_error";
  } else if (
    (currentStatus === "stale" || currentStatus === "unknown") &&
    !quotaPaused
  ) {
    eligibilityReason = "stale";
  }

  const eligible = eligibilityReason === null;

  return {
    windowStart,
    windowEnd,
    expectedCount,
    successCount,
    providerFailureCount,
    sampleCount,
    availabilityBps,
    coverageBps,
    grade:
      eligible && availabilityBps !== null
        ? gradeAvailability(availabilityBps)
        : null,
    currentStatus,
    eligible,
    eligibilityReason,
    validBucketCount,
    lastCheckAt,
  };
}

export function fillMissingBuckets(
  buckets: HealthBucketInput[],
  asOf: Date,
  expectedPerBucket: number,
  targetActiveFrom?: Date,
) {
  const { windowStart } = getCompletedWindow(asOf);
  const byStart = new Map(
    buckets.map((bucket) => [bucket.bucketStart.getTime(), bucket]),
  );
  const result: HealthBucketInput[] = [];

  for (let index = 0; index < BUCKET_COUNT; index += 1) {
    const bucketStart = new Date(windowStart.getTime() + index * BUCKET_MS);
    const existing = byStart.get(bucketStart.getTime());
    if (existing) {
      result.push(existing);
      continue;
    }

    const active = !targetActiveFrom || bucketStart >= targetActiveFrom;
    result.push({
      bucketStart,
      expectedCount: active ? expectedPerBucket : 0,
      attemptedCount: 0,
      successCount: 0,
      providerFailureCount: 0,
      configurationErrorCount: 0,
      observerErrorCount: 0,
      slowSuccessCount: 0,
      availabilityBps: null,
      coverageBps: 0,
      lastCheckAt: null,
    });
  }

  return result;
}
