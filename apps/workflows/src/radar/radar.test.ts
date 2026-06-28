import { describe, expect, test } from "bun:test";

import {
  classifyProbeFailure,
  evaluateRadarTargetStatus,
  RADAR_PROBE_PROMPT,
  redactProbeSummary,
  runOpenAICompatibleProbe,
  validateProbeBaseUrl,
} from "./index";

describe("Radar probe error classification", () => {
  test("classifies common OpenAI-compatible HTTP failures", () => {
    expect(classifyProbeFailure({ httpStatus: 401 })).toBe("auth_error");
    expect(classifyProbeFailure({ httpStatus: 429 })).toBe("rate_limited");
    expect(
      classifyProbeFailure({
        httpStatus: 429,
        bodyText: "You exceeded your current quota",
      }),
    ).toBe("insufficient_quota");
    expect(
      classifyProbeFailure({
        httpStatus: 404,
        bodyText: "model_not_found",
      }),
    ).toBe("model_not_found");
    expect(classifyProbeFailure({ httpStatus: 502 })).toBe("server_error");
  });

  test("redacts token-shaped values from summaries", () => {
    const summary = redactProbeSummary(
      "Authorization: Bearer sk-test_abcdefghijklmnopqrstuvwxyz1234567890",
    );

    expect(summary).toContain("[redacted]");
    expect(summary).not.toContain("sk-test");
  });
});

describe("Radar SSRF base URL validation", () => {
  test("blocks localhost, private-ish hostnames, and raw IPs", () => {
    expect(validateProbeBaseUrl("http://localhost:3000").ok).toBe(false);
    expect(validateProbeBaseUrl("https://api.internal").ok).toBe(false);
    expect(validateProbeBaseUrl("https://10.0.0.1/v1").ok).toBe(false);
    expect(validateProbeBaseUrl("https://[::1]/v1").ok).toBe(false);
  });

  test("allows normal HTTPS provider hostnames", () => {
    expect(validateProbeBaseUrl("https://api.example.com/v1").ok).toBe(true);
  });
});

describe("Radar status policy", () => {
  test("requires enough successes before operational", () => {
    expect(evaluateRadarTargetStatus({ recentResults: [] })).toBe("unknown");
    expect(
      evaluateRadarTargetStatus({
        recentResults: [{ success: true, totalLatencyMs: 100 }],
      }),
    ).toBe("unknown");
    expect(
      evaluateRadarTargetStatus({
        recentResults: [
          { success: true, totalLatencyMs: 100 },
          { success: true, totalLatencyMs: 120 },
        ],
      }),
    ).toBe("operational");
  });

  test("maps repeated failures and configuration failures", () => {
    expect(
      evaluateRadarTargetStatus({
        recentResults: [
          { success: false, errorType: "server_error", totalLatencyMs: 100 },
        ],
      }),
    ).toBe("degraded");
    expect(
      evaluateRadarTargetStatus({
        recentResults: [
          { success: false, errorType: "server_error", totalLatencyMs: 100 },
          { success: false, errorType: "timeout", totalLatencyMs: 20_000 },
          { success: false, errorType: "network_error", totalLatencyMs: 100 },
        ],
      }),
    ).toBe("down");
    expect(
      evaluateRadarTargetStatus({
        recentResults: [
          { success: false, errorType: "auth_error", totalLatencyMs: 100 },
        ],
      }),
    ).toBe("configuration_error");
  });

  test("keeps acceptable successful probes operational", () => {
    expect(
      evaluateRadarTargetStatus({
        recentResults: [
          { success: true, firstTokenMs: 12_000, totalLatencyMs: 13_000 },
          { success: true, firstTokenMs: 11_000, totalLatencyMs: 12_000 },
        ],
      }),
    ).toBe("operational");
  });

  test("marks very slow successful probes as degraded", () => {
    expect(
      evaluateRadarTargetStatus({
        recentResults: [
          { success: true, firstTokenMs: 16_000, totalLatencyMs: 17_000 },
          { success: true, firstTokenMs: 16_500, totalLatencyMs: 17_500 },
        ],
      }),
    ).toBe("degraded");
  });
});

describe("OpenAI-compatible probe skeleton", () => {
  test("sends the fixed low-cost chat completions request", async () => {
    let requestBody: unknown;
    let requestHeaders: HeadersInit | undefined;

    const result = await runOpenAICompatibleProbe({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      stream: false,
      maxTokens: 99,
      fetch: async (_url, init) => {
        requestHeaders = init?.headers;
        requestBody = JSON.parse(String(init?.body));

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 7, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      },
    });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.tokensIn).toBe(7);
    expect(result.tokensOut).toBe(1);
    expect(requestHeaders).toEqual({
      "cache-control": "no-store",
      "content-type": "application/json",
      pragma: "no-cache",
      authorization: "Bearer sk-test-secret",
    });
    expect(requestBody).toEqual({
      model: "gpt-test",
      messages: [{ role: "user", content: RADAR_PROBE_PROMPT }],
      temperature: 0,
      max_tokens: 1,
      stream: false,
    });
  });

  test("classifies quota errors without exposing the API key", async () => {
    const result = await runOpenAICompatibleProbe({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      stream: false,
      fetch: async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: "You exceeded your current quota",
              key: "sk-test-secret",
            },
          }),
          { status: 429 },
        );
      },
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe("insufficient_quota");
    expect(result.safeErrorSummary).not.toContain("sk-test-secret");
  });

  test("parses streamed first token and empty-stream failures", async () => {
    const success = await runOpenAICompatibleProbe({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      stream: true,
      fetch: async () => {
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"o"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"k"}}],"usage":{"prompt_tokens":7,"completion_tokens":1}}\n\n',
            "data: [DONE]\n\n",
          ].join(""),
          { status: 200 },
        );
      },
    });

    expect(success.success).toBe(true);
    expect(typeof success.firstTokenMs).toBe("number");
    expect(success.tokensIn).toBe(7);
    expect(success.tokensOut).toBe(1);

    const empty = await runOpenAICompatibleProbe({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      stream: true,
      fetch: async () => {
        return new Response("data: [DONE]\n\n", { status: 200 });
      },
    });

    expect(empty.success).toBe(false);
    expect(empty.errorType).toBe("empty_stream");
  });
});
