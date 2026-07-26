import { describe, expect, test } from "bun:test";

import {
  aggregateProbeSamples,
  BUCKET_COUNT,
  BUCKET_MS,
  calculateSevenDayStats,
  deriveCurrentStatus,
  fillMissingBuckets,
  floorToBucket,
  gradeAvailability,
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

  test("keeps a real zero score but excludes it below the ranking threshold", () => {
    const stats = calculateSevenDayStats(
      completeBuckets(0, 18),
      AS_OF,
      "normal",
    );

    expect(stats.eligible).toBe(false);
    expect(stats.availabilityBps).toBe(0);
    expect(stats.eligibilityReason).toBe("below_availability_threshold");
    expect(stats.grade).toBeNull();
  });

  test("allows the minimum ranking score to be configured", () => {
    const stats = calculateSevenDayStats(
      completeBuckets(0, 18),
      AS_OF,
      "normal",
      undefined,
      0,
    );

    expect(stats.eligible).toBe(true);
    expect(stats.availabilityBps).toBe(0);
    expect(stats.grade).toBe("D");
  });

  test("requires a complete seven-day observation window", () => {
    const stats = calculateSevenDayStats(
      completeBuckets().slice(1),
      AS_OF,
      "normal",
    );

    expect(stats.eligible).toBe(false);
    expect(stats.eligibilityReason).toBe("incomplete_window");
    expect(stats.grade).toBeNull();
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
});
