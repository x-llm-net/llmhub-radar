import { createMarketplaceDb } from "./db";
import {
  capturePendingHubUsageSettlements,
  releaseExpiredHubUsageAuthorizations,
} from "./hub-billing";
import { syncLegacyRadar } from "./legacy-radar-sync";
import { cleanupExpiredHistory, DEFAULT_CLEANUP_BATCH_SIZE } from "./retention";

const MAX_CLEANUP_BATCHES_PER_RUN = 100;
const BILLING_AUTHORIZATION_BATCH_SIZE = 100;

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
  let deletedHubProbeRuns = 0;
  let deletedHubProbeCycles = 0;
  let deletedHubBuckets = 0;

  try {
    for (let batch = 0; batch < MAX_CLEANUP_BATCHES_PER_RUN; batch += 1) {
      const result = await cleanupExpiredHistory(db);
      deletedChecks += result.deletedChecks;
      deletedBuckets += result.deletedBuckets;
      deletedHubProbeRuns += result.deletedHubProbeRuns;
      deletedHubProbeCycles += result.deletedHubProbeCycles;
      deletedHubBuckets += result.deletedHubBuckets;

      if (
        result.deletedChecks < DEFAULT_CLEANUP_BATCH_SIZE &&
        result.deletedBuckets < DEFAULT_CLEANUP_BATCH_SIZE &&
        result.deletedHubProbeRuns < DEFAULT_CLEANUP_BATCH_SIZE &&
        result.deletedHubProbeCycles < DEFAULT_CLEANUP_BATCH_SIZE &&
        result.deletedHubBuckets < DEFAULT_CLEANUP_BATCH_SIZE
      ) {
        break;
      }
    }

    return {
      deletedChecks,
      deletedBuckets,
      deletedHubProbeRuns,
      deletedHubProbeCycles,
      deletedHubBuckets,
    };
  } finally {
    await client.close();
  }
}

export async function runHubBillingMaintenanceFromEnv() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("MARKETPLACE_DATABASE_URL is required");
  }

  const { client, db } = createMarketplaceDb(databaseUrl);
  try {
    const settlementBefore = new Date();
    let captured = 0;
    let failed = 0;
    for (let batch = 0; batch < MAX_CLEANUP_BATCHES_PER_RUN; batch += 1) {
      const result = await capturePendingHubUsageSettlements(db, {
        before: settlementBefore,
        limit: BILLING_AUTHORIZATION_BATCH_SIZE,
      });
      captured += result.captured;
      failed += result.failed;
      if (result.processed < BILLING_AUTHORIZATION_BATCH_SIZE) break;
    }
    let released = 0;
    for (let batch = 0; batch < MAX_CLEANUP_BATCHES_PER_RUN; batch += 1) {
      const result = await releaseExpiredHubUsageAuthorizations(db, {
        limit: BILLING_AUTHORIZATION_BATCH_SIZE,
      });
      released += result.released;
      if (result.released < BILLING_AUTHORIZATION_BATCH_SIZE) break;
    }
    return { captured, failed, released };
  } finally {
    await client.close();
  }
}
