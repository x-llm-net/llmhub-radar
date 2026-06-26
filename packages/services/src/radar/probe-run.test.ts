import { describe, expect, test } from "bun:test";

import { hasConfirmedRecovery } from "./probe-run";

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
