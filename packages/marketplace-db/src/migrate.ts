import { resolve } from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createMarketplaceDb } from "./db";

async function main() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("MARKETPLACE_DATABASE_URL is required");
  }

  const { client, db } = createMarketplaceDb(databaseUrl);
  try {
    await migrate(db, {
      migrationsFolder: resolve(__dirname, "../migrations"),
    });
    console.log("Marketplace database migrations completed");
  } finally {
    await client.close();
  }
}

void main();
