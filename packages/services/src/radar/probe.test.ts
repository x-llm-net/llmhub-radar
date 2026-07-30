import { describe, expect, test } from "bun:test";

import { RADAR_PROBE_PROMPT, runOpenAICompatibleProbe } from "./probe";

describe("runOpenAICompatibleProbe", () => {
  test("uses a minimal no-store chat completions probe", async () => {
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
            choices: [{ message: { content: "h" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      },
    });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.tokensIn).toBe(1);
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

  test("treats an empty successful response as a bad probe response", async () => {
    const result = await runOpenAICompatibleProbe({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      stream: false,
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "" } }],
            usage: { prompt_tokens: 1, completion_tokens: 0 },
          }),
          { status: 200 },
        ),
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe("bad_response");
  });

  test("classifies zero-balance provider responses as insufficient quota", async () => {
    const result = await runOpenAICompatibleProbe({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      stream: false,
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { message: "账户可用余额不足，请充值后重试" },
          }),
          { status: 403 },
        ),
    });

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(403);
    expect(result.errorType).toBe("insufficient_quota");
  });
});
