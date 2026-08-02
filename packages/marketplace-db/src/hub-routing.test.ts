import { describe, expect, test } from "bun:test";

import {
  generateHubApiToken,
  hashHubApiToken,
  normalizeModelName,
} from "./hub-routing";

describe("Hub routing primitives", () => {
  test("generates a token that can be verified without storing plaintext", () => {
    const generated = generateHubApiToken();

    expect(generated.token).toMatch(/^lh_[A-Za-z0-9_-]{43}$/);
    expect(generated.prefix).toBe(generated.token.slice(0, 12));
    expect(generated.tokenHash).toBe(hashHubApiToken(generated.token));
    expect(generated.tokenHash).not.toContain(generated.token);
  });

  test("normalizes model names consistently for aliases and canonical names", () => {
    expect(normalizeModelName("  GPT-5.6-SOL ")).toBe("gpt-5.6-sol");
  });
});
