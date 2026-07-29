import { describe, expect, test } from "bun:test";

import {
  aggregateProbeSamples,
  BUCKET_COUNT,
  BUCKET_MS,
  calculateRankingScoreBps,
  calculateSevenDayStats,
  confidenceScoreBps,
  deriveCurrentStatus,
  fillMissingBuckets,
  floorToBucket,
  gradeAvailability,
  linearLatencyScoreBps,
  percentile,
  type HealthBucketInput,
} from "./scoring";

const AS_OF = new Date("2026-07-23T12:34:56.000Z");

function completeBuckets(
  successCount = 18,
  providerFailureCount = 0,
): HealthBucketInput[] {
  const end = floorToBucket(AS_OF);
  return Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const bucketStart = new Date(
      end.getTime() - (BUCKET_COUNT - index) * BUCKET_MS,
    );
    const sampleCount = successCount + providerFailureCount;
    return {
      bucketStart,
      expectedCount: 18,
      attemptedCount: sampleCount,
      successCount,
      providerFailureCount,
      configurationErrorCount: 0,
      observerErrorCount: 0,
      slowSuccessCount: 0,
      availabilityBps: Math.round((successCount / sampleCount) * 10_000),
      coverageBps: 10_000,
      lastCheckAt: new Date(bucketStart.getTime() + 17 * 10 * 60 * 1000),
    };
  });
}

describe("marketplace scoring", () => {
  test("aligns buckets to three-hour UTC boundaries", () => {
    expect(floorToBucket(AS_OF).toISOString()).toBe("2026-07-23T12:00:00.000Z");
  });

  test.each([
    [9_800, "S"],
    [9_799, "A"],
    [9_500, "A"],
    [9_499, "B"],
    [9_000, "B"],
    [8_000, "C"],
    [7_999, "D"],
  ] as const)("maps %i basis points to grade %s", (score, grade) => {
    expect(gradeAvailability(score)).toBe(grade);
  });

  test("counts only the primary attempt in availability", () => {
    const bucketStart = floorToBucket(AS_OF);
    const bucket = aggregateProbeSamples(bucketStart, 1, [
      {
        attemptNo: 0,
        outcome: "provider_failure",
        scheduledAt: bucketStart,
      },
      {
        attemptNo: 1,
        outcome: "success",
        scheduledAt: bucketStart,
      },
    ]);

    expect(bucket.providerFailureCount).toBe(1);
    expect(bucket.successCount).toBe(0);
    expect(bucket.availabilityBps).toBe(0);
  });

  test("keeps configuration and observer errors out of the denominator", () => {
    const bucketStart = floorToBucket(AS_OF);
    const bucket = aggregateProbeSamples(bucketStart, 4, [
      { attemptNo: 0, outcome: "success", scheduledAt: bucketStart },
      {
        attemptNo: 0,
        outcome: "provider_failure",
        scheduledAt: bucketStart,
      },
      {
        attemptNo: 0,
        outcome: "configuration_error",
        scheduledAt: bucketStart,
      },
      { attemptNo: 0, outcome: "observer_error", scheduledAt: bucketStart },
    ]);

    expect(bucket.availabilityBps).toBe(5_000);
    expect(bucket.coverageBps).toBe(5_000);
  });

  test("keeps a real zero score eligible after enough samples", () => {
    const stats = calculateSevenDayStats(
      completeBuckets(0, 18),
      AS_OF,
      "normal",
    );

    expect(stats.eligible).toBe(true);
    expect(stats.availabilityBps).toBe(0);
    expect(stats.eligibilityReason).toBeNull();
    expect(stats.grade).toBe("D");
  });

  test("keeps a target observing until four scoreable samples exist", () => {
    const stats = calculateSevenDayStats(
      [
        {
          bucketStart: new Date(floorToBucket(AS_OF).getTime() - BUCKET_MS),
          expectedCount: 18,
          attemptedCount: 3,
          successCount: 2,
          providerFailureCount: 1,
          configurationErrorCount: 0,
          observerErrorCount: 0,
          slowSuccessCount: 0,
          availabilityBps: 6_667,
          coverageBps: 1_667,
          lastCheckAt: new Date(AS_OF.getTime() - 5 * 60 * 1000),
        },
      ],
      AS_OF,
      "normal",
    );

    expect(stats.eligible).toBe(false);
    expect(stats.sampleCount).toBe(3);
    expect(stats.eligibilityReason).toBe("insufficient_samples");
    expect(stats.grade).toBeNull();
  });

  test("does not require a complete seven-day observation window", () => {
    const stats = calculateSevenDayStats(
      completeBuckets().slice(1),
      AS_OF,
      "normal",
    );

    expect(stats.eligible).toBe(true);
    expect(stats.eligibilityReason).toBeNull();
    expect(stats.grade).toBe("S");
  });

  test("fills every missing trend slot with a no-data bucket", () => {
    const filled = fillMissingBuckets([], AS_OF, 18);

    expect(filled).toHaveLength(56);
    expect(filled.every((bucket) => bucket.availabilityBps === null)).toBe(
      true,
    );
  });

  test("marks three consecutive primary failures as down", () => {
    const now = new Date("2026-07-23T12:20:00.000Z");
    const samples = [0, 1, 2].map((index) => ({
      attemptNo: 0,
      outcome: "provider_failure" as const,
      scheduledAt: new Date(now.getTime() - index * 10 * 60 * 1000),
    }));

    expect(deriveCurrentStatus(samples, now)).toBe("down");
  });

  test("calculates first-token percentiles with nearest-rank buckets", () => {
    expect(percentile([2_000, 100, 900, 1_000], 50)).toBe(900);
    expect(percentile([2_000, 100, 900, 1_000], 95)).toBe(2_000);
    expect(percentile([], 50)).toBeNull();
  });

  test("scores latency linearly until the zero point", () => {
    expect(linearLatencyScoreBps(900, 10_000)).toBe(9_100);
    expect(linearLatencyScoreBps(10_000, 10_000)).toBe(0);
    expect(linearLatencyScoreBps(12_000, 10_000)).toBe(0);
    expect(linearLatencyScoreBps(null, 10_000)).toBe(0);
  });

  test("balances sample count and bucket coverage for confidence", () => {
    expect(confidenceScoreBps({ sampleCount: 350, validBucketCount: 28 })).toBe(
      5_000,
    );
    expect(confidenceScoreBps({ sampleCount: 700, validBucketCount: 56 })).toBe(
      10_000,
    );
    expect(
      confidenceScoreBps({ sampleCount: 1_400, validBucketCount: 112 }),
    ).toBe(10_000);
  });

  test("keeps ranking score internal with availability as the main weight", () => {
    const fast = calculateRankingScoreBps({
      availabilityBps: 9_900,
      firstTokenP50Ms: 900,
      firstTokenP95Ms: 1_800,
      sampleCount: 700,
      validBucketCount: 56,
    });
    const slow = calculateRankingScoreBps({
      availabilityBps: 9_900,
      firstTokenP50Ms: 5_000,
      firstTokenP95Ms: 12_000,
      sampleCount: 700,
      validBucketCount: 56,
    });

    expect(fast).toBe(9_785);
    expect(slow).toBeLessThan(fast);
    expect(slow).toBeGreaterThan(9_000);
  });
});
