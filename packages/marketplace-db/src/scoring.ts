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

export function aggregateProbeSamples(
  bucketStart: Date,
  expectedCount: number,
  samples: ProbeSample[],
  slowFirstTokenMs = DEFAULT_SLOW_FIRST_TOKEN_MS,
): HealthBucketInput {
  const primarySamples = samples.filter((sample) => sample.attemptNo === 0);
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

export function calculateSevenDayStats(
  buckets: HealthBucketInput[],
  asOf: Date,
  currentStatus: CurrentStatusValue,
  _observationStartedAt?: Date,
  _minRankingAvailabilityBps = DEFAULT_MIN_RANKING_AVAILABILITY_BPS,
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
  } else if (currentStatus === "configuration_error") {
    eligibilityReason = "configuration_error";
  } else if (currentStatus === "stale" || currentStatus === "unknown") {
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
