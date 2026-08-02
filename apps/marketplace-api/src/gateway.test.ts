import { describe, expect, test } from "bun:test";

import {
  createFakeHubTrafficAdapter,
  createHttpHubTrafficAdapter,
} from "./gateway";

describe("LLMHub traffic adapters", () => {
  test("fake adapter can model a first-route failure followed by success", async () => {
    const adapter = createFakeHubTrafficAdapter({
      failOnceChannelIds: ["channel-a"],
    });
    const input = {
      requestId: "request-1",
      externalChannelId: "channel-a",
      model: "gpt-5.5",
      body: { model: "gpt-5.5", messages: [] },
    };

    expect((await adapter.forward(input)).status).toBe(503);
    const second = await adapter.forward(input);
    expect(second.status).toBe(200);
    expect(second.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("HTTP adapter forwards the selected channel and model", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const adapter = createHttpHubTrafficAdapter({
      endpoint: "https://relay.example.test/internal/",
      token: "internal-token",
      fetch: (async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Response.json({
          id: "upstream-1",
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        });
      }) as typeof fetch,
    });

    const response = await adapter.forward({
      requestId: "request-2",
      externalChannelId: "channel-b",
      model: "canonical-gpt-5.5",
      body: { model: "canonical-gpt-5.5", messages: [] },
    });

    expect(response.status).toBe(200);
    expect(response.usage).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(calls).toEqual([
      {
        url: "https://relay.example.test/internal/channels/channel-b/chat/completions",
        body: { model: "canonical-gpt-5.5", messages: [] },
      },
    ]);
  });
});
