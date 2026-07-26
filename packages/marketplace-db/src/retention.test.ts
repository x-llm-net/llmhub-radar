import { describe, expect, test } from "bun:test";

import {
  BUCKET_RETENTION_MONTHS,
  getRetentionCutoffs,
  RAW_CHECK_RETENTION_DAYS,
} from "./retention";

describe("marketplace retention", () => {
  test("keeps raw checks for 30 days", () => {
    const cutoffs = getRetentionCutoffs(new Date("2026-07-23T12:00:00.000Z"));

    expect(RAW_CHECK_RETENTION_DAYS).toBe(30);
    expect(cutoffs.checksBefore.toISOString()).toBe("2026-06-23T12:00:00.000Z");
  });

  test("keeps three-hour aggregates for 13 months", () => {
    const cutoffs = getRetentionCutoffs(new Date("2026-07-23T12:00:00.000Z"));

    expect(BUCKET_RETENTION_MONTHS).toBe(13);
    expect(cutoffs.bucketsBefore.toISOString()).toBe(
      "2025-06-23T12:00:00.000Z",
    );
  });
});
