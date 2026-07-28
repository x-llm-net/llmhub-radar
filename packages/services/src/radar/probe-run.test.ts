import { describe, expect, test } from "bun:test";

import {
  hasConfirmedRecovery,
  shouldAutoPauseRadarCredential,
} from "./probe-run";

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
