import { createHash } from "node:crypto";

import {
  getHomepageRankings,
  getMarketplaceOverview,
  getMarketplaceMinRankingAvailabilityBps,
  getModelLeaderboard,
  getProviderRankings,
  listPublicMarketplaceModels,
  presentMarketplaceModel,
  type MarketplaceDb,
} from "@llmhub/marketplace-db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

const PUBLIC_CACHE_INTERVAL_MS = 10 * 60 * 1000;
const PUBLIC_CACHE_MAX_ENTRIES = 256;

type PublicCacheEntry = {
  bucketStartMs: number;
  body: string;
  etag: string;
  status: number;
};

function getPublicCacheAsOf(now = new Date()) {
  return new Date(
    Math.floor(now.getTime() / PUBLIC_CACHE_INTERVAL_MS) *
      PUBLIC_CACHE_INTERVAL_MS,
  );
}

function createCacheEntry(
  bucketStartMs: number,
  payload: unknown,
  status = 200,
): PublicCacheEntry {
  const body = JSON.stringify(payload);
  return {
    bucketStartMs,
    body,
    etag: `"${createHash("sha256").update(body).digest("base64url")}"`,
    status,
  };
}

function responseFromCache(request: Request, entry: PublicCacheEntry) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil(
      (entry.bucketStartMs + PUBLIC_CACHE_INTERVAL_MS - Date.now()) / 1000,
    ),
  );
  const browserMaxAge = Math.min(60, remainingSeconds);
  const headers = {
    "cache-control": `public, max-age=${browserMaxAge}, s-maxage=${remainingSeconds}, stale-while-revalidate=600, stale-if-error=86400`,
    "content-type": "application/json; charset=UTF-8",
    etag: entry.etag,
  };

  if (request.headers.get("if-none-match") === entry.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(entry.body, { status: entry.status, headers });
}

export function createMarketplaceApp(db: MarketplaceDb) {
  const app = new Hono();
  const publicCache = new Map<string, PublicCacheEntry>();
  const pendingLoads = new Map<string, Promise<PublicCacheEntry>>();

  async function cachedRoute(
    request: Request,
    key: string,
    load: (asOf: Date) => Promise<{ payload: unknown; status?: number }>,
  ) {
    const asOf = getPublicCacheAsOf();
    const bucketStartMs = asOf.getTime();
    const existing = publicCache.get(key);
    if (existing?.bucketStartMs === bucketStartMs) {
      return responseFromCache(request, existing);
    }

    const pendingKey = `${key}:${bucketStartMs}`;
    let pending = pendingLoads.get(pendingKey);
    if (!pending) {
      pending = load(asOf).then((result) =>
        createCacheEntry(bucketStartMs, result.payload, result.status),
      );
      pendingLoads.set(pendingKey, pending);
    }
    let entry: PublicCacheEntry;
    try {
      entry = await pending;
    } finally {
      if (pendingLoads.get(pendingKey) === pending) {
        pendingLoads.delete(pendingKey);
      }
    }

    if (publicCache.size >= PUBLIC_CACHE_MAX_ENTRIES) {
      for (const [cacheKey, value] of publicCache) {
        if (value.bucketStartMs !== bucketStartMs) publicCache.delete(cacheKey);
      }
      while (publicCache.size >= PUBLIC_CACHE_MAX_ENTRIES) {
        const oldestKey = publicCache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        publicCache.delete(oldestKey);
      }
    }
    publicCache.set(key, entry);
    return responseFromCache(request, entry);
  }

  app.use(
    "/v1/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.get("/health", async (context) => {
    await db.execute(sql`SELECT 1`);
    return context.json({ ok: true });
  });

  app.get("/v1/models", (context) =>
    cachedRoute(context.req.raw, "models", async () => {
      const rows = await listPublicMarketplaceModels(db);
      const catalog = rows.map((row) => {
        const { sortOrder: _sortOrder, ...model } = row;
        return presentMarketplaceModel(model);
      });
      return { payload: { data: catalog } };
    }),
  );

  app.get("/v1/models/:slug/leaderboard", (context) => {
    const slug = context.req.param("slug");
    return cachedRoute(context.req.raw, `model:${slug}`, async (asOf) => {
      const [result, minRankingAvailabilityBps] = await Promise.all([
        getModelLeaderboard(db, slug, { asOf }),
        getMarketplaceMinRankingAvailabilityBps(db),
      ]);
      if (!result) {
        return {
          payload: {
            error: { code: "model_not_found", message: "Model not found" },
          },
          status: 404,
        };
      }
      return {
        payload: {
          data: result,
          meta: { minRankingScore: minRankingAvailabilityBps / 100 },
        },
      };
    });
  });

  app.get("/v1/providers/:slug/rankings", (context) => {
    const slug = context.req.param("slug");
    return cachedRoute(context.req.raw, `provider:${slug}`, async (asOf) => {
      const [result, minRankingAvailabilityBps] = await Promise.all([
        getProviderRankings(db, slug, { asOf }),
        getMarketplaceMinRankingAvailabilityBps(db),
      ]);
      if (!result) {
        return {
          payload: {
            error: {
              code: "provider_not_found",
              message: "Provider not found",
            },
          },
          status: 404,
        };
      }
      return {
        payload: {
          data: result,
          meta: { minRankingScore: minRankingAvailabilityBps / 100 },
        },
      };
    });
  });

  app.get("/v1/homepage", (context) =>
    cachedRoute(context.req.raw, "homepage", async (asOf) => {
      const [rankings, meta, minRankingAvailabilityBps] = await Promise.all([
        getHomepageRankings(db, { asOf }),
        getMarketplaceOverview(db),
        getMarketplaceMinRankingAvailabilityBps(db),
      ]);
      return {
        payload: {
          data: rankings,
          meta: {
            ...meta,
            minRankingScore: minRankingAvailabilityBps / 100,
          },
        },
      };
    }),
  );

  app.notFound((context) =>
    context.json(
      { error: { code: "not_found", message: "Route not found" } },
      404,
    ),
  );

  app.onError((error, context) => {
    console.error(error);
    return context.json(
      {
        error: {
          code: "internal_error",
          message: "Marketplace request failed",
        },
      },
      500,
    );
  });

  return app;
}
