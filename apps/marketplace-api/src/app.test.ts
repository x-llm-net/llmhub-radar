import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createMarketplaceDb,
  models,
  probeTargets,
  providerModels,
  providers,
  setMarketplaceMinRankingAvailabilityBps,
} from "@llmhub/marketplace-db";
import { eq } from "drizzle-orm";

import { createMarketplaceApp } from "./app";

const databaseUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  console.warn(
    "Skipping Marketplace API tests: MARKETPLACE_TEST_DATABASE_URL is required.",
  );
}

describeDatabase("marketplace public API", () => {
  if (!databaseUrl) return;

  const { client, db } = createMarketplaceDb(databaseUrl);
  const app = createMarketplaceApp(db);

  beforeAll(async () => {
    const [model] = await db
      .insert(models)
      .values({
        slug: "gpt-5-4",
        vendor: "OpenAI",
        family: "GPT",
        displayName: "GPT 5.4",
        shortName: "GPT 5.4",
        aliases: ["gpt-5.4", "gpt-5-4"],
        visibility: "auto",
      })
      .onConflictDoUpdate({
        target: models.slug,
        set: { visibility: "auto", enabled: true },
      })
      .returning({ id: models.id });
    const [provider] = await db
      .insert(providers)
      .values({
        slug: "marketplace-api-test-provider",
        name: "Marketplace API Test Provider",
        status: "published",
      })
      .onConflictDoUpdate({
        target: providers.slug,
        set: { status: "published" },
      })
      .returning({ id: providers.id });
    if (!model || !provider) throw new Error("Unable to create API test data");
    const [listing] = await db
      .insert(providerModels)
      .values({
        providerId: provider.id,
        modelId: model.id,
        providerModelName: "gpt-5.4",
        status: "observing",
      })
      .onConflictDoUpdate({
        target: [providerModels.providerId, providerModels.modelId],
        set: { status: "observing" },
      })
      .returning({ id: providerModels.id });
    if (!listing) throw new Error("Unable to create API test listing");
    await db
      .insert(probeTargets)
      .values({
        providerModelId: listing.id,
        name: "marketplace-api-test-target",
        source: "legacy_radar",
        sourceRef: "marketplace-api-test-target",
        enabled: true,
        isScoring: true,
      })
      .onConflictDoUpdate({
        target: [probeTargets.source, probeTargets.sourceRef],
        set: { enabled: true, isScoring: true },
      });
    await db
      .insert(models)
      .values({
        slug: "unassociated-api-test-model",
        vendor: "Other",
        family: "Other",
        displayName: "Unassociated API Test Model",
        shortName: "Unassociated API Test Model",
        visibility: "auto",
      })
      .onConflictDoUpdate({
        target: models.slug,
        set: { visibility: "auto", enabled: true },
      });
  });

  afterAll(async () => {
    await client.close();
  });

  test("serves the model catalog with a boundary-aligned ten-minute cache", async () => {
    const response = await app.request("/v1/models");
    const payload = (await response.json()) as { data: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.data).toContainEqual(
      expect.objectContaining({ slug: "gpt-5-4" }),
    );
    expect(payload.data).not.toContainEqual(
      expect.objectContaining({ slug: "unassociated-api-test-model" }),
    );
    const cacheControl = response.headers.get("cache-control") ?? "";
    const sharedMaxAge = Number(/s-maxage=(\d+)/.exec(cacheControl)?.[1]);
    expect(sharedMaxAge).toBeGreaterThan(0);
    expect(sharedMaxAge).toBeLessThanOrEqual(600);
    expect(response.headers.get("etag")).toBeTruthy();
  });

  test("reuses the in-process response cache within a ten-minute bucket", async () => {
    const isolatedApp = createMarketplaceApp(db);
    const first = await isolatedApp.request("/v1/models");
    const firstPayload = (await first.json()) as {
      data: Array<{ slug: string; description: string }>;
    };
    const original = firstPayload.data.find(
      (model) => model.slug === "gpt-5-4",
    );
    expect(original).toBeDefined();
    if (!original) return;

    await db
      .update(models)
      .set({ description: "cache-mutation" })
      .where(eq(models.slug, "gpt-5-4"));
    const second = await isolatedApp.request("/v1/models");
    const secondPayload = (await second.json()) as {
      data: Array<{ slug: string; description: string }>;
    };
    expect(
      secondPayload.data.find((model) => model.slug === "gpt-5-4")?.description,
    ).toBe(original.description);

    await db
      .update(models)
      .set({ description: original.description })
      .where(eq(models.slug, "gpt-5-4"));
  });

  test("supports conditional requests through ETag", async () => {
    const first = await app.request("/v1/models");
    const etag = first.headers.get("etag");
    const second = await app.request("/v1/models", {
      headers: { "if-none-match": etag ?? "" },
    });

    expect(second.status).toBe(304);
  });

  test("keeps homepage ETags stable within the cache window", async () => {
    const first = await app.request("/v1/homepage");
    const payload = (await first.clone().json()) as {
      data: unknown[];
      meta: {
        providerCount: number;
        latestStatsAt: string | null;
        minRankingScore: number;
      };
    };
    const etag = first.headers.get("etag");
    const second = await app.request("/v1/homepage", {
      headers: { "if-none-match": etag ?? "" },
    });

    expect(first.status).toBe(200);
    expect(payload.meta.providerCount).toBeGreaterThanOrEqual(0);
    expect(
      payload.meta.latestStatsAt === null ||
        typeof payload.meta.latestStatsAt === "string",
    ).toBe(true);
    expect(payload.meta.minRankingScore).toBeGreaterThanOrEqual(0);
    expect(payload.meta.minRankingScore).toBeLessThanOrEqual(100);
    expect(second.status).toBe(304);
  });

  test("returns a structured 404 for unknown models", async () => {
    const response = await app.request("/v1/models/not-a-model/leaderboard");
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("model_not_found");
  });

  test("returns a structured 404 for unknown providers", async () => {
    const response = await app.request("/v1/providers/not-a-provider/rankings");
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("provider_not_found");
  });

  test("reports that there is no minimum ranking score gate", async () => {
    await setMarketplaceMinRankingAvailabilityBps(db, 8_300);
    const isolatedApp = createMarketplaceApp(db);
    const response = await isolatedApp.request("/v1/homepage");
    const payload = (await response.json()) as {
      meta: { minRankingScore: number };
    };

    expect(payload.meta.minRankingScore).toBe(0);
    await setMarketplaceMinRankingAvailabilityBps(db, 0);
  });

  test("publishes crawler discovery documents from the public catalog", async () => {
    const [robotsResponse, sitemapResponse, llmsResponse] = await Promise.all([
      app.request("/robots.txt"),
      app.request("/sitemap.xml"),
      app.request("/llms.txt"),
    ]);
    const [robots, sitemap, llms] = await Promise.all([
      robotsResponse.text(),
      sitemapResponse.text(),
      llmsResponse.text(),
    ]);

    expect(robotsResponse.status).toBe(200);
    expect(robots).toContain("Sitemap: https://llm-hub.store/sitemap.xml");
    expect(sitemapResponse.headers.get("content-type")).toContain(
      "application/xml",
    );
    expect(sitemap).toContain("https://llm-hub.store/model.html?model=gpt-5-4");
    expect(sitemap).not.toContain("unassociated-api-test-model");
    expect(sitemap).toContain(
      "https://llm-hub.store/provider.html?slug=marketplace-api-test-provider",
    );
    expect(llmsResponse.headers.get("content-type")).toContain("text/plain");
    expect(llms).toContain("# LLMHub Radar");
    expect(llms).toContain("GPT 5.4");
    expect(llms).toContain("Marketplace API Test Provider");
  });
});
