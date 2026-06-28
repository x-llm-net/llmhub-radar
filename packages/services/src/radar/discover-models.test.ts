import { describe, expect, test } from "bun:test";

import type { ServiceContext } from "../context";
import { buildModelsUrl, discoverRadarModels } from "./discover-models";

const ctx = {
  workspace: { id: 1 },
  actor: { type: "system", job: "test" },
} as ServiceContext;

describe("buildModelsUrl", () => {
  test("normalizes OpenAI-compatible model URLs", () => {
    expect(buildModelsUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1/models",
    );
    expect(buildModelsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/models",
    );
  });
});

describe("discoverRadarModels", () => {
  test("uses a clear error for unreachable provider hosts", async () => {
    await expect(
      discoverRadarModels({
        ctx,
        input: {
          baseUrl: "https://api.example.com",
          apiKey: "sk-test-secret",
        },
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      "Model discovery failed: could not reach api.example.com. Please check the provider Base URL.",
    );
  });
});
