import { sql } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import { healthBuckets3h, probeChecks } from "./schema";

export const RAW_CHECK_RETENTION_DAYS = 30;
export const BUCKET_RETENTION_MONTHS = 13;
export const DEFAULT_CLEANUP_BATCH_SIZE = 10_000;

export function getRetentionCutoffs(now = new Date()) {
  const checksBefore = new Date(now);
  checksBefore.setUTCDate(checksBefore.getUTCDate() - RAW_CHECK_RETENTION_DAYS);

  const bucketsBefore = new Date(now);
  bucketsBefore.setUTCMonth(
    bucketsBefore.getUTCMonth() - BUCKET_RETENTION_MONTHS,
  );

  return { checksBefore, bucketsBefore };
}

export async function cleanupExpiredHistory(
  db: MarketplaceDb,
  options: { now?: Date; batchSize?: number } = {},
) {
  const { checksBefore, bucketsBefore } = getRetentionCutoffs(options.now);
  const batchSize = Math.max(
    1,
    options.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE,
  );
  const checksBeforeIso = checksBefore.toISOString();
  const bucketsBeforeIso = bucketsBefore.toISOString();
  let deletedChecks = 0;
  let deletedBuckets = 0;

  while (true) {
    const rows = await db.execute<{ id: number }>(sql`
      WITH doomed AS (
        SELECT ${probeChecks.id}
        FROM ${probeChecks}
        WHERE ${probeChecks.scheduledAt} < ${checksBeforeIso}
        ORDER BY ${probeChecks.scheduledAt}
        LIMIT ${batchSize}
      )
      DELETE FROM ${probeChecks}
      WHERE ${probeChecks.id} IN (SELECT id FROM doomed)
      RETURNING ${probeChecks.id}
    `);
    deletedChecks += rows.length;
    if (rows.length < batchSize) break;
  }

  while (true) {
    const rows = await db.execute<{
      providerModelId: string;
      bucketStart: Date;
    }>(sql`
      WITH doomed AS (
        SELECT ${healthBuckets3h.providerModelId}, ${healthBuckets3h.bucketStart}
        FROM ${healthBuckets3h}
        WHERE ${healthBuckets3h.bucketStart} < ${bucketsBeforeIso}
        ORDER BY ${healthBuckets3h.bucketStart}
        LIMIT ${batchSize}
      )
      DELETE FROM ${healthBuckets3h}
      USING doomed
      WHERE ${healthBuckets3h.providerModelId} = doomed.provider_model_id
        AND ${healthBuckets3h.bucketStart} = doomed.bucket_start
      RETURNING ${healthBuckets3h.providerModelId}, ${healthBuckets3h.bucketStart}
    `);
    deletedBuckets += rows.length;
    if (rows.length < batchSize) break;
  }

  return {
    checksBefore,
    bucketsBefore,
    deletedChecks,
    deletedBuckets,
  };
}
