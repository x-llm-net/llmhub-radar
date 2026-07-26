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
    const slugs = process.env.MARKETPLACE_LEGACY_PUBLIC_SLUGS?.split(",")
      .map((slug) => slug.trim())
      .filter(Boolean);
    const configuredMinScore = process.env.MARKETPLACE_MIN_RANKING_SCORE;
    let minRankingAvailabilityBps: number | undefined;
    if (configuredMinScore !== undefined) {
      const parsedMinScore = Number(configuredMinScore);
      if (
        !Number.isFinite(parsedMinScore) ||
        parsedMinScore < 0 ||
        parsedMinScore > 100
      ) {
        throw new Error(
          "MARKETPLACE_MIN_RANKING_SCORE must be a number from 0 to 100",
        );
      }
      minRankingAvailabilityBps = Math.round(parsedMinScore * 100);
    }

    return await syncLegacyRadar({
      db,
      baseUrl: process.env.MARKETPLACE_LEGACY_PUBLIC_URL,
      slugs,
      minRankingAvailabilityBps,
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
