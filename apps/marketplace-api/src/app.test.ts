import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createMarketplaceDb,
  models,
  seedModelCatalog,
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
    await seedModelCatalog(db);
  });

  afterAll(async () => {
    await client.close();
  });

  test("serves the model catalog with a boundary-aligned ten-minute cache", async () => {
    const response = await app.request("/v1/models");
    const payload = (await response.json()) as { data: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.data.length).toBeGreaterThanOrEqual(11);
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

    await seedModelCatalog(db);
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
});
