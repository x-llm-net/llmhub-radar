import { serve } from "@hono/node-server";
import { createMarketplaceDb } from "@llmhub/marketplace-db";

import { createMarketplaceApp } from "./app";

const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MARKETPLACE_DATABASE_URL is required");
}

const port = Number(process.env.PORT ?? 3010);
const { db } = createMarketplaceDb(databaseUrl);
const app = createMarketplaceApp(db);

serve({
  port,
  fetch: app.fetch,
});

console.log(`Marketplace API listening on http://127.0.0.1:${port}`);
