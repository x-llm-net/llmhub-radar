import { describe, expect, test } from "bun:test";

import { statusPageAlternates } from "./alternates";

describe("statusPageAlternates", () => {
  test("subdomain, default markdown path → overview", () => {
    expect(statusPageAlternates({ slug: "acme" })).toEqual({
      canonical: "https://llm-hub.store/acme",
      types: {
        "text/markdown": "https://llm-hub.store/acme/.md",
        "application/json":
          "https://llm-hub.store/acme/api/status/summary.json",
      },
    });
  });

  test("custom domain wins over subdomain", () => {
    expect(
      statusPageAlternates({ slug: "acme", customDomain: "status.acme.com" }),
    ).toEqual({
      canonical: "https://status.acme.com",
      types: {
        "text/markdown": "https://status.acme.com/.md",
        "application/json": "https://status.acme.com/api/status/summary.json",
      },
    });
  });

  test("null customDomain falls back to subdomain", () => {
    expect(statusPageAlternates({ slug: "acme", customDomain: null })).toEqual({
      canonical: "https://llm-hub.store/acme",
      types: {
        "text/markdown": "https://llm-hub.store/acme/.md",
        "application/json":
          "https://llm-hub.store/acme/api/status/summary.json",
      },
    });
  });

  test("per-page markdown path, subdomain", () => {
    const result = statusPageAlternates({
      slug: "acme",
      markdownPath: "/monitors/123.md",
    });
    expect(result?.types?.["text/markdown"]).toBe(
      "https://llm-hub.store/acme/monitors/123.md",
    );
    // canonical and json alternate stay at the page root regardless of md path
    expect(result?.canonical).toBe("https://llm-hub.store/acme");
    expect(result?.types?.["application/json"]).toBe(
      "https://llm-hub.store/acme/api/status/summary.json",
    );
  });

  test("per-page markdown path, custom domain", () => {
    expect(
      statusPageAlternates({
        slug: "acme",
        customDomain: "status.acme.com",
        markdownPath: "/events/report/7.md",
      })?.types?.["text/markdown"],
    ).toBe("https://status.acme.com/events/report/7.md");
  });
});
