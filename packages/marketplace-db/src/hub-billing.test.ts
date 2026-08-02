import { describe, expect, test } from "bun:test";

import { calculateHubUsageCharge, HUB_PLATFORM_FEE_BPS } from "./hub-billing";

describe("Hub usage billing", () => {
  test("calculates token price, multiplier and platform fee in integer micros", () => {
    const charge = calculateHubUsageCharge({
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      multiplierBps: 8_000,
      components: [
        {
          component: "input_text",
          unit: "million_tokens",
          unitSize: 1,
          amountMicros: 2_000_000n,
        },
        {
          component: "output_text",
          unit: "million_tokens",
          unitSize: 1,
          amountMicros: 4_000_000n,
        },
      ],
    });

    expect(charge.userAmountMicros).toBe(3_200_000n);
    expect(charge.platformFeeMicros).toBe(
      (3_200_000n * BigInt(HUB_PLATFORM_FEE_BPS)) / 10_000n,
    );
    expect(charge.providerPayoutMicros + charge.platformFeeMicros).toBe(
      charge.userAmountMicros,
    );
  });

  test("rounds a sub-micro component up once instead of silently charging zero", () => {
    const charge = calculateHubUsageCharge({
      usage: { inputTokens: 1 },
      multiplierBps: 10_000,
      components: [
        {
          component: "input_text",
          unit: "million_tokens",
          unitSize: 1,
          amountMicros: 1n,
        },
      ],
    });

    expect(charge.userAmountMicros).toBe(1n);
    expect(charge.providerPayoutMicros).toBe(1n);
  });
});
