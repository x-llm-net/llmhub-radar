import { describe, expect, test } from "bun:test";

import {
  BUCKET_COUNT,
  BUCKET_MS,
  calculateSevenDayStats,
  floorToBucket,
  type HealthBucketInput,
} from "./scoring";

describe("marketplace qualification", () => {
  test("ranks a target before a full seven-day observation once it has four samples", () => {
    const asOf = new Date("2026-07-23T12:34:56.000Z");
    const windowEnd = floorToBucket(asOf);
    const buckets: HealthBucketInput[] = Array.from(
      { length: BUCKET_COUNT },
      (_, index) => {
        const bucketStart = new Date(
          windowEnd.getTime() - (BUCKET_COUNT - index) * BUCKET_MS,
        );
        return {
          bucketStart,
          expectedCount: 18,
          attemptedCount: 18,
          successCount: 18,
          providerFailureCount: 0,
          configurationErrorCount: 0,
          observerErrorCount: 0,
          slowSuccessCount: 0,
          availabilityBps: 10_000,
          coverageBps: 10_000,
          lastCheckAt: bucketStart,
        };
      },
    );
    const startedSixDaysAgo = new Date(
      asOf.getTime() - 6 * 24 * 60 * 60 * 1000,
    );
    const stats = calculateSevenDayStats(
      buckets,
      asOf,
      "normal",
      startedSixDaysAgo,
    );

    expect(stats.eligible).toBe(true);
    expect(stats.eligibilityReason).toBeNull();
    expect(stats.sampleCount).toBeGreaterThanOrEqual(4);
  });
});
