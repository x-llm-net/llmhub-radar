import { serve } from "@hono/node-server";
import { createMarketplaceDb } from "@llmhub/marketplace-db";

import { createMarketplaceApp } from "./app";
import {
  createFakeHubTrafficAdapter,
  createHttpHubTrafficAdapter,
} from "./gateway";

const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MARKETPLACE_DATABASE_URL is required");
}

const port = Number(process.env.PORT ?? 3010);
const hostname = process.env.MARKETPLACE_HOST ?? "0.0.0.0";
const { db } = createMarketplaceDb(databaseUrl);
const fakeRouterEnabled = process.env.LLMHUB_ROUTER_FAKE === "true";
if (fakeRouterEnabled && process.env.NODE_ENV === "production") {
  throw new Error("LLMHUB_ROUTER_FAKE cannot be enabled in production");
}
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.LLMHUB_RELAY_REQUEST_URL ||
    !process.env.LLMHUB_RELAY_REQUEST_TOKEN)
) {
  throw new Error(
    "LLMHUB_RELAY_REQUEST_URL and LLMHUB_RELAY_REQUEST_TOKEN are required in production",
  );
}
const trafficAdapter = fakeRouterEnabled
  ? createFakeHubTrafficAdapter()
  : process.env.LLMHUB_RELAY_REQUEST_URL &&
      process.env.LLMHUB_RELAY_REQUEST_TOKEN
    ? createHttpHubTrafficAdapter({
        endpoint: process.env.LLMHUB_RELAY_REQUEST_URL,
        token: process.env.LLMHUB_RELAY_REQUEST_TOKEN,
      })
    : undefined;
const app = createMarketplaceApp(db, { trafficAdapter });

serve({
  port,
  hostname,
  fetch: app.fetch,
});

console.log(`Marketplace API listening on http://${hostname}:${port}`);
