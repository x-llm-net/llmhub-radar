import { createMarketplaceDb } from "./db";
import { syncLegacyRadar } from "./legacy-radar-sync";
import { cleanupExpiredHistory, DEFAULT_CLEANUP_BATCH_SIZE } from "./retention";

const MAX_CLEANUP_BATCHES_PER_RUN = 100;

export async function runLegacySyncFromEnv() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("MARKETPLACE_DATABASE_URL is required");
  }

  const { client, db } = createMarketplaceDb(databaseUrl);

  try {
    return await syncLegacyRadar({
      db,
      baseUrl: process.env.MARKETPLACE_LEGACY_PUBLIC_URL,
    });
  } finally {
    await client.close();
  }
}

export async function runCleanupFromEnv() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("MARKETPLACE_DATABASE_URL is required");
  }

  const { client, db } = createMarketplaceDb(databaseUrl);
  let deletedChecks = 0;
  let deletedBuckets = 0;

  try {
    for (let batch = 0; batch < MAX_CLEANUP_BATCHES_PER_RUN; batch += 1) {
      const result = await cleanupExpiredHistory(db);
      deletedChecks += result.deletedChecks;
      deletedBuckets += result.deletedBuckets;

      if (
        result.deletedChecks < DEFAULT_CLEANUP_BATCH_SIZE &&
        result.deletedBuckets < DEFAULT_CLEANUP_BATCH_SIZE
      ) {
        break;
      }
    }

    return { deletedChecks, deletedBuckets };
  } finally {
    await client.close();
  }
}
