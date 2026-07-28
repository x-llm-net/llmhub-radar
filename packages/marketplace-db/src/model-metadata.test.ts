import { describe, expect, test } from "bun:test";

import {
  compareMarketplaceModels,
  formatModelDisplayName,
  formatModelShortName,
  inferModelMetadata,
  presentMarketplaceModel,
} from "./model-metadata";

describe("marketplace model metadata", () => {
  test("formats slugs into public model names", () => {
    expect(formatModelDisplayName("gpt-5-6-sol")).toBe("GPT 5.6 Sol");
    expect(formatModelDisplayName("gpt-5.5")).toBe("GPT 5.5");
    expect(formatModelDisplayName("claude-sonnet-4-6")).toBe(
      "Claude Sonnet 4.6",
    );
    expect(formatModelDisplayName("llama-3.1-405b")).toBe("Llama 3.1 405B");
    expect(formatModelShortName("claude-sonnet-4-6")).toBe("Sonnet 4.6");
  });

  test("infers provider metadata from discovered model names", () => {
    expect(inferModelMetadata("gpt-5-6-sol")).toEqual({
      vendor: "OpenAI",
      family: "GPT",
    });
    expect(inferModelMetadata("llama-3.1-405b")).toEqual({
      vendor: "Meta",
      family: "Llama",
    });
  });

  test("keeps database display overrides for true exceptions", () => {
    expect(
      presentMarketplaceModel({
        slug: "gpt-5-5",
        displayName: "gpt-5.5",
        shortName: "gpt-5.5",
      }),
    ).toEqual({
      slug: "gpt-5-5",
      displayName: "GPT 5.5",
      shortName: "GPT 5.5",
    });
    expect(
      presentMarketplaceModel({
        slug: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6 Special",
        shortName: "Sonnet Special",
      }),
    ).toEqual({
      slug: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6 Special",
      shortName: "Sonnet Special",
    });
  });

  test("sorts families and model versions for the marketplace rail", () => {
    const slugs = [
      "claude-sonnet-4-6",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "gpt-5-4",
      "gpt-5-3-codex",
      "gpt-5-5",
      "gpt-5-6-sol",
      "gemini-3-flash-preview",
      "gemini-3-5-flash",
      "gemini-3-6-flash",
    ];

    expect(
      slugs.map((slug) => ({ slug })).sort(compareMarketplaceModels),
    ).toEqual([
      { slug: "claude-sonnet-5" },
      { slug: "claude-sonnet-4-6" },
      { slug: "claude-opus-4-8" },
      { slug: "claude-fable-5" },
      { slug: "gpt-5-6-sol" },
      { slug: "gpt-5-5" },
      { slug: "gpt-5-4" },
      { slug: "gpt-5-3-codex" },
      { slug: "gemini-3-6-flash" },
      { slug: "gemini-3-5-flash" },
      { slug: "gemini-3-flash-preview" },
    ]);
  });
});
