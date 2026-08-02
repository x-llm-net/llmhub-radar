import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createHubGroup,
  createMarketplaceDb,
  hubGroupBlocks,
  hubGroupModels,
  hubGroupModelStats,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubHealthBuckets3h,
  hubModelAliases,
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
  hubProbeCycles,
  hubProbeRuns,
  hubProbeTargets,
  hubProviderGroups,
  hubProviders,
  setMarketplaceMinRankingAvailabilityBps,
} from "@llmhub/marketplace-db";
import { encryptSecret } from "@openstatus/services/radar/runtime";
import { eq, inArray } from "drizzle-orm";

import { createMarketplaceApp } from "./app";

describe("marketplace management API", () => {
  test("rejects browser requests without the internal management token", async () => {
    const app = createMarketplaceApp(
      {} as ReturnType<typeof createMarketplaceDb>["db"],
    );
    const response = await app.request(
      "/v1/manage/groups?workspaceId=workspace-test",
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  test("returns a structured 400 for invalid management input", async () => {
    const app = createMarketplaceApp(
      {} as ReturnType<typeof createMarketplaceDb>["db"],
    );
    const response = await app.request(
      "/v1/manage/groups/not-a-uuid?workspaceId=workspace-test",
      {
        headers: {
          authorization: "Bearer llmhub-marketplace-local-management",
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "Invalid request" },
    });
  });
});

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
  const workspaceId = "workspace-marketplace-api-test";
  const providerSlug = "marketplace-api-test-provider";
  const apiKey = "sk-marketplace-api-test";
  let groupIds: string[] = [];
  let apiKeyCiphertext = "";

  beforeAll(async () => {
    await cleanupApiTestData();
    const baseUrlCiphertext = await encryptSecret(
      "https://marketplace-api-test.example/v1",
    );
    apiKeyCiphertext = await encryptSecret(apiKey);
    for (const [name, multiplierBps] of [
      ["Plus", 6_000],
      ["Pro", 8_000],
    ] as const) {
      const group = await createHubGroup(db, {
        ownerWorkspaceId: workspaceId,
        providerSlug,
        providerName: "Marketplace API Test Provider",
        name,
        baseUrlCiphertext,
        baseUrlHostHash: "marketplace-api-test-host-hash",
        apiKeyCiphertext,
        keyFingerprint: "marketplace-api-test-key-fingerprint",
        apiKeyLastFour: "test",
        multiplierBps,
        discoveredModels: ["gpt-5.4"],
      });
      groupIds.push(group.id);
    }
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready", listingStatus: "listed" })
      .where(inArray(hubProviderGroups.id, groupIds));

    const groupModels = await db
      .select({ id: hubGroupModels.id })
      .from(hubGroupModels)
      .where(inArray(hubGroupModels.groupId, groupIds));
    const now = new Date();
    for (let index = 0; index < groupModels.length; index += 1) {
      const groupModel = groupModels[index];
      if (!groupModel) continue;
      await db.insert(hubGroupModelStats).values({
        groupModelId: groupModel.id,
        windowStart: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        windowEnd: now,
        availabilityBps: 9_900 - index * 100,
        coverageBps: 10_000,
        grade: "S",
        firstTokenP50Ms: 900 + index * 100,
        firstTokenP95Ms: 1_500 + index * 100,
        sampleCount: 10,
        validBucketCount: 4,
        rankingScoreBps: 9_500 - index * 100,
        currentStatus: "normal",
        eligible: true,
        lastCheckAt: now,
      });
    }
    await db
      .insert(hubModels)
      .values({
        slug: "unassociated-api-test-model",
        vendor: "Other",
        family: "Other",
        canonicalName: "unassociated-api-test-model",
        displayName: "Unassociated API Test Model",
        shortName: "Unassociated API Test Model",
      })
      .onConflictDoNothing({ target: hubModels.slug });
  });

  afterAll(async () => {
    await cleanupApiTestData();
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
      .update(hubModels)
      .set({ description: "cache-mutation" })
      .where(eq(hubModels.slug, "gpt-5-4"));
    const second = await isolatedApp.request("/v1/models");
    const secondPayload = (await second.json()) as {
      data: Array<{ slug: string; description: string }>;
    };
    expect(
      secondPayload.data.find((model) => model.slug === "gpt-5-4")?.description,
    ).toBe(original.description);

    await db
      .update(hubModels)
      .set({ description: original.description })
      .where(eq(hubModels.slug, "gpt-5-4"));
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

  test("returns both groups from one provider for the same model", async () => {
    const homepage = await app.request("/v1/homepage");
    const homepagePayload = (await homepage.json()) as {
      data: Array<{
        model: { slug: string };
        ranking: Array<{ provider: { slug: string }; group: { name: string } }>;
      }>;
    };
    const board = homepagePayload.data.find(
      (entry) => entry.model.slug === "gpt-5-4",
    );
    expect(
      board?.ranking
        .filter((row) => row.provider.slug === providerSlug)
        .map((row) => row.group.name)
        .sort(),
    ).toEqual(["Plus", "Pro"]);

    const provider = await app.request(
      `/v1/providers/${providerSlug}/rankings`,
    );
    const providerPayload = (await provider.json()) as {
      data: {
        models: Array<{
          ranking: { group: { name: string } } | null;
          observing: { group: { name: string } } | null;
        }>;
      };
    };
    expect(
      providerPayload.data.models
        .map(
          (entry) => entry.ranking?.group.name ?? entry.observing?.group.name,
        )
        .sort(),
    ).toEqual(["Plus", "Pro"]);
  });

  test("protects group details and never returns key material", async () => {
    const groupId = groupIds[0];
    expect(groupId).toBeDefined();
    if (!groupId) return;

    const unauthorized = await app.request(
      `/v1/manage/groups/${groupId}?workspaceId=${workspaceId}`,
    );
    expect(unauthorized.status).toBe(401);

    const denied = await app.request(
      `/v1/manage/groups/${groupId}?workspaceId=another-workspace`,
      { headers: managementHeaders() },
    );
    expect(denied.status).toBe(404);

    const response = await app.request(
      `/v1/manage/groups/${groupId}?workspaceId=${workspaceId}`,
      { headers: managementHeaders() },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(apiKeyCiphertext);
    expect(serialized).not.toContain("marketplace-api-test-key-fingerprint");
    expect(serialized).not.toContain("baseUrlCiphertext");
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

  function managementHeaders() {
    return { authorization: "Bearer llmhub-marketplace-local-management" };
  }

  async function cleanupApiTestData() {
    const providerRows = await db
      .select({ id: hubProviders.id })
      .from(hubProviders)
      .where(eq(hubProviders.ownerWorkspaceId, workspaceId));
    const providerIds = providerRows.map((provider) => provider.id);
    if (providerIds.length > 0) {
      const groups = await db
        .select({ id: hubProviderGroups.id })
        .from(hubProviderGroups)
        .where(inArray(hubProviderGroups.providerId, providerIds));
      const ids = groups.map((group) => group.id);
      if (ids.length > 0) {
        const groupModels = await db
          .select({ id: hubGroupModels.id })
          .from(hubGroupModels)
          .where(inArray(hubGroupModels.groupId, ids));
        const groupModelIds = groupModels.map((model) => model.id);
        if (groupModelIds.length > 0) {
          const targets = await db
            .select({ id: hubProbeTargets.id })
            .from(hubProbeTargets)
            .where(inArray(hubProbeTargets.groupModelId, groupModelIds));
          const targetIds = targets.map((target) => target.id);
          await db
            .delete(hubProbeRuns)
            .where(inArray(hubProbeRuns.groupModelId, groupModelIds));
          if (targetIds.length > 0) {
            await db
              .delete(hubProbeCycles)
              .where(inArray(hubProbeCycles.targetId, targetIds));
          }
          await db
            .delete(hubGroupModelStats)
            .where(inArray(hubGroupModelStats.groupModelId, groupModelIds));
          await db
            .delete(hubHealthBuckets3h)
            .where(inArray(hubHealthBuckets3h.groupModelId, groupModelIds));
          await db
            .delete(hubProbeTargets)
            .where(inArray(hubProbeTargets.groupModelId, groupModelIds));
        }
        await db
          .delete(hubGroupBlocks)
          .where(inArray(hubGroupBlocks.groupId, ids));
        await db
          .delete(hubGroupModels)
          .where(inArray(hubGroupModels.groupId, ids));
        await db
          .delete(hubGroupPriceVersions)
          .where(inArray(hubGroupPriceVersions.groupId, ids));
        await db
          .delete(hubGroupSecrets)
          .where(inArray(hubGroupSecrets.groupId, ids));
        await db
          .delete(hubProviderGroups)
          .where(inArray(hubProviderGroups.id, ids));
      }
      await db
        .delete(hubProviders)
        .where(inArray(hubProviders.id, providerIds));
    }

    const testModels = await db
      .select({ id: hubModels.id })
      .from(hubModels)
      .where(
        inArray(hubModels.slug, ["gpt-5-4", "unassociated-api-test-model"]),
      );
    const modelIds = testModels.map((model) => model.id);
    if (modelIds.length > 0) {
      const priceVersions = await db
        .select({ id: hubModelPriceVersions.id })
        .from(hubModelPriceVersions)
        .where(inArray(hubModelPriceVersions.modelId, modelIds));
      const priceVersionIds = priceVersions.map((version) => version.id);
      if (priceVersionIds.length > 0) {
        await db
          .delete(hubModelPriceComponents)
          .where(
            inArray(hubModelPriceComponents.priceVersionId, priceVersionIds),
          );
      }
      await db
        .delete(hubModelPriceVersions)
        .where(inArray(hubModelPriceVersions.modelId, modelIds));
      await db
        .delete(hubModelAliases)
        .where(inArray(hubModelAliases.modelId, modelIds));
      await db.delete(hubModels).where(inArray(hubModels.id, modelIds));
    }
    groupIds = [];
  }
});
