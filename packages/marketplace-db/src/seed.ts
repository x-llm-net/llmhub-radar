import { seedModelCatalog } from "./catalog";
import { createMarketplaceDb } from "./db";

async function main() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("MARKETPLACE_DATABASE_URL is required");
  }

  const { client, db } = createMarketplaceDb(databaseUrl);
  try {
    const catalog = await seedModelCatalog(db);
    console.log("Seeded " + catalog.length + " marketplace models");
  } finally {
    await client.close();
  }
}

void main();
