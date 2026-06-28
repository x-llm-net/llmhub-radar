import { describe, expect, test } from "bun:test";

import { normalizeRadarBaseUrl } from "./base-url";

describe("normalizeRadarBaseUrl", () => {
  test("rejects single-label public hostnames", () => {
    expect(() => normalizeRadarBaseUrl("https://x-llm")).toThrow(
      "Base URL must use a full hostname",
    );
  });

  test("accepts normal provider hostnames", () => {
    expect(normalizeRadarBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
  });
});
