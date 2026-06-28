import { describe, expect, test } from "bun:test";

import {
  getPriorityProbeConfig,
  isRetryableProbeResult,
  parsePriorityPoolSlugs,
  runProbeWithOptionalRetry,
} from "./priority-probe";
import type { RadarProbeResult } from "./probe";

describe("priority radar probe config", () => {
  test("matches configured pool slugs case-insensitively", () => {
    const config = getPriorityProbeConfig("x-llm", {
      RADAR_PRIORITY_POOL_SLUGS: " skyhope, X-LLM ",
      RADAR_PRIORITY_PROBE_RETRIES: "1",
      RADAR_PRIORITY_PROBE_RETRY_BACKOFF_MS: "1500",
    });

    expect(config.enabled).toBe(true);
    expect(config.retryAttempts).toBe(1);
    expect(config.retryBackoffMs).toBe(1500);
  });

  test("caps unsafe retry settings from the environment", () => {
    const config = getPriorityProbeConfig("x-llm", {
      RADAR_PRIORITY_POOL_SLUGS: "x-llm",
      RADAR_PRIORITY_PROBE_RETRIES: "99",
      RADAR_PRIORITY_PROBE_RETRY_BACKOFF_MS: "999999",
    });

    expect(config.enabled).toBe(true);
    expect(config.retryAttempts).toBe(2);
    expect(config.retryBackoffMs).toBe(30_000);
  });

  test("parses comma-separated pool slugs", () => {
    expect(Array.from(parsePriorityPoolSlugs(" x-llm,, skyhope "))).toEqual([
      "x-llm",
      "skyhope",
    ]);
  });
});

describe("priority radar probe retry", () => {
  test("retries timeout/network/server failures only", () => {
    expect(
      isRetryableProbeResult({
        success: false,
        errorType: "timeout",
        totalLatencyMs: 100,
      }),
    ).toBe(true);
    expect(
      isRetryableProbeResult({
        success: false,
        errorType: "network_error",
        totalLatencyMs: 100,
      }),
    ).toBe(true);
    expect(
      isRetryableProbeResult({
        success: false,
        errorType: "server_error",
        totalLatencyMs: 100,
      }),
    ).toBe(true);
    expect(
      isRetryableProbeResult({
        success: false,
        errorType: "auth_error",
        totalLatencyMs: 100,
      }),
    ).toBe(false);
    expect(
      isRetryableProbeResult({
        success: false,
        errorType: "rate_limited",
        totalLatencyMs: 100,
      }),
    ).toBe(false);
  });

  test("returns the first non-retryable failure without retrying", async () => {
    let calls = 0;

    const result = await runProbeWithOptionalRetry({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
      retryAttempts: 1,
      retryBackoffMs: 10,
      probe: async () => {
        calls += 1;
        return {
          success: false,
          errorType: "auth_error",
          totalLatencyMs: 100,
        };
      },
      sleepFn: async () => {},
    });

    expect(calls).toBe(1);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("auth_error");
  });

  test("retries retryable failures and records final timing from the first attempt", async () => {
    const results: RadarProbeResult[] = [
      { success: false, errorType: "timeout", totalLatencyMs: 20_000 },
      {
        success: true,
        httpStatus: 200,
        ttfbMs: 500,
        firstTokenMs: 1_000,
        totalLatencyMs: 1_200,
      },
    ];
    const sleeps: number[] = [];

    const result = await runProbeWithOptionalRetry({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
      retryAttempts: 1,
      retryBackoffMs: 1_500,
      probe: async () => {
        const next = results.shift();
        if (!next) {
          throw new Error("missing probe result");
        }
        return next;
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(sleeps).toEqual([1_500]);
    expect(result.success).toBe(true);
    expect(result.ttfbMs).toBe(22_000);
    expect(result.firstTokenMs).toBe(22_500);
    expect(result.totalLatencyMs).toBe(22_700);
  });
});
