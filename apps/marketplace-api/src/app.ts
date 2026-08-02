import { createHash } from "node:crypto";

import {
  getHubHomepageRankings,
  getHubMarketplaceOverview,
  getHubModelLeaderboard,
  getHubProviderRankings,
  getMarketplaceMinRankingAvailabilityBps,
  listPublicHubModels,
  listPublicHubProviders,
  presentMarketplaceModel,
  type MarketplaceDb,
} from "@llmhub/marketplace-db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createHubGatewayApp, type HubTrafficAdapter } from "./gateway";
import { createManagementApp } from "./management";

const PUBLIC_CACHE_INTERVAL_MS = 10 * 60 * 1000;
const PUBLIC_CACHE_MAX_ENTRIES = 256;
const PUBLIC_ORIGIN = (
  process.env.MARKETPLACE_PUBLIC_ORIGIN || "https://llm-hub.store"
).replace(/\/+$/, "");

type PublicCacheEntry = {
  bucketStartMs: number;
  body: string;
  etag: string;
  status: number;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function markdownLinkLabel(value: string) {
  return singleLine(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function textDocument(
  body: string,
  contentType: "application/xml" | "text/plain",
) {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control":
        "public, max-age=300, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400",
      "content-type": `${contentType}; charset=UTF-8`,
    },
  });
}

function marketplaceUrl(pathname: string) {
  return `${PUBLIC_ORIGIN}${pathname}`;
}

function sitemapEntry(args: {
  pathname: string;
  lastModified?: Date;
  changeFrequency: "hourly" | "daily" | "weekly";
  priority: string;
}) {
  const values = [
    "  <url>",
    `    <loc>${escapeXml(marketplaceUrl(args.pathname))}</loc>`,
  ];
  if (args.lastModified) {
    values.push(`    <lastmod>${args.lastModified.toISOString()}</lastmod>`);
  }
  values.push(
    `    <changefreq>${args.changeFrequency}</changefreq>`,
    `    <priority>${args.priority}</priority>`,
    "  </url>",
  );
  return values.join("\n");
}

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

export function createMarketplaceApp(
  db: MarketplaceDb,
  options: { trafficAdapter?: HubTrafficAdapter } = {},
) {
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
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "HEAD", "OPTIONS", "POST"],
      maxAge: 600,
    }),
  );

  app.get("/health", async (context) => {
    await db.execute(sql`SELECT 1`);
    return context.json({ ok: true });
  });

  app.route("/v1/manage", createManagementApp(db));
  app.route("/v1", createHubGatewayApp(db, options));

  app.get("/robots.txt", () =>
    textDocument(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/auth/",
        "Disallow: /*/login",
        "Disallow: /*/manage/",
        "Disallow: /*/unsubscribe/",
        "Disallow: /*/verify/",
        "Disallow: /*?*embed=",
        "",
        `Sitemap: ${marketplaceUrl("/sitemap.xml")}`,
        "",
      ].join("\n"),
      "text/plain",
    ),
  );

  app.get("/sitemap.xml", async () => {
    const [catalog, publicProviders] = await Promise.all([
      listPublicHubModels(db),
      listPublicHubProviders(db),
    ]);
    const entries = [
      sitemapEntry({
        pathname: "/",
        changeFrequency: "hourly",
        priority: "1.0",
      }),
      sitemapEntry({
        pathname: "/developers/api",
        changeFrequency: "weekly",
        priority: "0.6",
      }),
      ...catalog.map((model) =>
        sitemapEntry({
          pathname: `/model.html?model=${encodeURIComponent(model.slug)}`,
          lastModified: model.updatedAt,
          changeFrequency: "hourly",
          priority: "0.8",
        }),
      ),
      ...publicProviders.flatMap((provider) => [
        sitemapEntry({
          pathname: `/provider.html?slug=${encodeURIComponent(provider.slug)}`,
          lastModified: provider.updatedAt,
          changeFrequency: "hourly",
          priority: "0.7",
        }),
        sitemapEntry({
          pathname: `/${encodeURIComponent(provider.slug)}`,
          lastModified: provider.updatedAt,
          changeFrequency: "hourly",
          priority: "0.7",
        }),
      ]),
    ];

    return textDocument(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries,
        "</urlset>",
        "",
      ].join("\n"),
      "application/xml",
    );
  });

  app.get("/llms.txt", async () => {
    const [catalog, publicProviders] = await Promise.all([
      listPublicHubModels(db),
      listPublicHubProviders(db),
    ]);
    const lines = [
      "# LLMHub Radar",
      "",
      "> Independent observations of AI API relay availability and first-token latency. Rankings are generated from recurring real API probes.",
      "",
      "## Main pages",
      `- [Marketplace rankings](${marketplaceUrl("/")}): model-by-model provider rankings`,
      `- [Ranking rules](${marketplaceUrl("/#rules")}): methodology, data source, and sponsorship policy`,
      `- [Developer API](${marketplaceUrl("/developers/api")}): public provider stability API`,
      "",
      "## Machine-readable data",
      `- [Homepage ranking data](${marketplaceUrl("/v1/homepage")}): all public model leaderboards`,
      `- [Model catalog](${marketplaceUrl("/v1/models")}): public models and metadata`,
      "",
      "## Models",
      ...catalog.map(
        (model) =>
          `- [${markdownLinkLabel(model.displayName)}](${marketplaceUrl(`/model.html?model=${encodeURIComponent(model.slug)}`)}): ${singleLine(model.vendor)} ${singleLine(model.family)} provider ranking`,
      ),
      "",
      "## Providers",
      ...publicProviders.map(
        (provider) =>
          `- [${markdownLinkLabel(provider.name)}](${marketplaceUrl(`/provider.html?slug=${encodeURIComponent(provider.slug)}`)}): model-level probe results and public status`,
      ),
      "",
      "## Methodology notes",
      "- The primary observation window is the most recent seven days.",
      "- Rankings prioritize observed availability and also consider first-token latency and data coverage.",
      "- Four valid probe samples are required before a provider-model pair enters a ranking.",
      "- Sponsored placements are labeled separately and never alter organic ranking order.",
      "- Results are observations, not an official SLA, model quality score, price ranking, or purchase recommendation.",
      "- API keys and raw private probe evidence are never published.",
      "",
    ];
    return textDocument(lines.join("\n"), "text/plain");
  });

  app.get("/v1/models", (context) =>
    cachedRoute(context.req.raw, "models", async () => {
      const rows = await listPublicHubModels(db);
      const catalog = rows.map((row) => {
        const { sortOrder: _sortOrder, updatedAt: _updatedAt, ...model } = row;
        return presentMarketplaceModel(model);
      });
      return { payload: { data: catalog } };
    }),
  );

  app.get("/v1/models/:slug/leaderboard", (context) => {
    const slug = context.req.param("slug");
    return cachedRoute(context.req.raw, `model:${slug}`, async (asOf) => {
      const [result, minRankingAvailabilityBps] = await Promise.all([
        getHubModelLeaderboard(db, slug, { asOf }),
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
        getHubProviderRankings(db, slug, { asOf }),
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
        getHubHomepageRankings(db, { asOf }),
        getHubMarketplaceOverview(db),
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
