import { describe, expect, test } from "bun:test";

import {
  expectedLegacyChecksPerBucket,
  legacyListingStatus,
  mapLegacyOutcome,
} from "./legacy-radar-sync";

describe("legacy Radar listing status", () => {
  test("keeps the first two model-not-found failures observable", () => {
    expect(legacyListingStatus({ modelNotFoundCount: 2 })).toBe("observing");
  });

  test("suspends the listing after three consecutive failures", () => {
    expect(legacyListingStatus({ modelNotFoundCount: 3 })).toBe("suspended");
  });

  test("returns the listing to observation after recovery", () => {
    expect(legacyListingStatus({ modelNotFoundCount: 0 })).toBe("observing");
  });
});

describe("legacy Radar outcome mapping", () => {
  test("keeps successful checks scoreable", () => {
    expect(mapLegacyOutcome({ success: true, errorType: null })).toBe(
      "success",
    );
  });

  test("excludes owner configuration failures from availability", () => {
    for (const errorType of [
      "auth_error",
      "insufficient_quota",
      "model_not_found",
    ]) {
      expect(mapLegacyOutcome({ success: false, errorType })).toBe(
        "configuration_error",
      );
    }
  });

  test("excludes legacy auth errors with balance summaries from availability", () => {
    expect(
      mapLegacyOutcome({
        success: false,
        errorType: "auth_error",
        safeErrorSummary:
          'HTTP 403: auth_error: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
      }),
    ).toBe("configuration_error");
  });

  test("counts transient upstream failures against availability", () => {
    for (const errorType of [
      "timeout",
      "network_error",
      "server_error",
      "rate_limited",
      "bad_response",
      "unknown",
    ]) {
      expect(mapLegacyOutcome({ success: false, errorType })).toBe(
        "provider_failure",
      );
    }
  });

  test("derives expected bucket coverage from the configured interval", () => {
    expect(expectedLegacyChecksPerBucket(600)).toBe(18);
    expect(expectedLegacyChecksPerBucket(660)).toBe(16);
    expect(expectedLegacyChecksPerBucket(600, [8, 16, 16, 17, 17, 17])).toBe(
      17,
    );
  });
});
