import { describe, expect, test } from "bun:test";

import {
  hasConfirmedRecovery,
  nextModelNotFoundState,
  RADAR_MODEL_NOT_FOUND_HIDE_THRESHOLD,
  RADAR_MODEL_NOT_FOUND_RETIRE_THRESHOLD,
  shouldAutoPauseRadarCredential,
} from "./probe-run";

describe("nextModelNotFoundState", () => {
  test("increments consecutive model-not-found failures", () => {
    expect(
      nextModelNotFoundState({
        previousCount: 0,
        success: false,
        errorType: "model_not_found",
      }),
    ).toEqual({ count: 1, retired: false });
  });

  test("clears the count after a successful probe", () => {
    expect(
      nextModelNotFoundState({
        previousCount: 7,
        success: true,
        errorType: null,
      }),
    ).toEqual({ count: 0, retired: false });
  });

  test("clears the count when another error interrupts the sequence", () => {
    expect(
      nextModelNotFoundState({
        previousCount: 7,
        success: false,
        errorType: "timeout",
      }),
    ).toEqual({ count: 0, retired: false });
  });

  test("continues probing after the marketplace hide threshold", () => {
    expect(
      nextModelNotFoundState({
        previousCount: RADAR_MODEL_NOT_FOUND_HIDE_THRESHOLD - 1,
        success: false,
        errorType: "model_not_found",
      }),
    ).toEqual({
      count: RADAR_MODEL_NOT_FOUND_HIDE_THRESHOLD,
      retired: false,
    });
  });

  test("retires the target at the stop threshold", () => {
    expect(
      nextModelNotFoundState({
        previousCount: RADAR_MODEL_NOT_FOUND_RETIRE_THRESHOLD - 1,
        success: false,
        errorType: "model_not_found",
      }),
    ).toEqual({
      count: RADAR_MODEL_NOT_FOUND_RETIRE_THRESHOLD,
      retired: true,
    });
  });
});

describe("shouldAutoPauseRadarCredential", () => {
  test("does not pause after one insufficient quota failure", () => {
    expect(
      shouldAutoPauseRadarCredential([
        { success: false, errorType: "insufficient_quota" },
      ]),
    ).toBe(false);
  });

  test("pauses after two consecutive insufficient quota failures", () => {
    expect(
      shouldAutoPauseRadarCredential([
        { success: false, errorType: "insufficient_quota" },
        { success: false, errorType: "insufficient_quota" },
      ]),
    ).toBe(true);
  });

  test("pauses when older auth errors contain quota summaries", () => {
    expect(
      shouldAutoPauseRadarCredential([
        { success: false, errorType: "insufficient_quota" },
        {
          success: false,
          errorType: "auth_error",
          safeErrorSummary:
            'HTTP 403: auth_error: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
        },
      ]),
    ).toBe(true);
  });

  test("does not pause when a successful probe interrupts the failures", () => {
    expect(
      shouldAutoPauseRadarCredential([
        { success: false, errorType: "insufficient_quota" },
        { success: true },
        { success: false, errorType: "insufficient_quota" },
      ]),
    ).toBe(false);
  });
});

describe("hasConfirmedRecovery", () => {
  test("requires three recent successful probes", () => {
    expect(
      hasConfirmedRecovery([
        { success: true },
        { success: true },
        { success: true },
      ]),
    ).toBe(true);
  });

  test("does not confirm with fewer than three probes", () => {
    expect(hasConfirmedRecovery([{ success: true }, { success: true }])).toBe(
      false,
    );
  });

  test("does not confirm when any recent probe failed", () => {
    expect(
      hasConfirmedRecovery([
        { success: true },
        { success: false },
        { success: true },
        { success: true },
      ]),
    ).toBe(false);
  });
});
