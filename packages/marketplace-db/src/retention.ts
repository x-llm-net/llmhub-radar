import { sql } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  healthBuckets3h,
  hubHealthBuckets3h,
  hubProbeCycles,
  hubProbeRuns,
  probeChecks,
} from "./schema";

export const RAW_CHECK_RETENTION_DAYS = 30;
export const BUCKET_RETENTION_MONTHS = 13;
export const DEFAULT_CLEANUP_BATCH_SIZE = 10_000;
export const HUB_PROBE_PARTITIONS_AHEAD = 3;

export function getHubProbePartitionWindows(
  now = new Date(),
  monthsAhead = HUB_PROBE_PARTITIONS_AHEAD,
) {
  return Array.from({ length: Math.max(1, monthsAhead + 1) }, (_, index) => {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 1),
    );
    const suffix = `${start.getUTCFullYear()}_${String(
      start.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    return { name: `hub_probe_runs_${suffix}`, start, end };
  });
}

export async function ensureHubProbeRunPartitions(
  db: MarketplaceDb,
  now = new Date(),
) {
  const windows = getHubProbePartitionWindows(now);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('hub_probe_runs_partitions'))`,
    );
    await tx.execute(
      sql.raw(
        'ALTER TABLE "hub_probe_runs" DETACH PARTITION "hub_probe_runs_default"',
      ),
    );
    for (const window of windows) {
      await tx.execute(
        sql.raw(
          `CREATE TABLE IF NOT EXISTS "${window.name}" PARTITION OF "hub_probe_runs" FOR VALUES FROM ('${window.start.toISOString()}') TO ('${window.end.toISOString()}')`,
        ),
      );
      await tx.execute(
        sql.raw(
          `INSERT INTO "hub_probe_runs" SELECT * FROM "hub_probe_runs_default" WHERE "scheduled_at" >= '${window.start.toISOString()}' AND "scheduled_at" < '${window.end.toISOString()}' ON CONFLICT DO NOTHING`,
        ),
      );
      await tx.execute(
        sql.raw(
          `DELETE FROM "hub_probe_runs_default" WHERE "scheduled_at" >= '${window.start.toISOString()}' AND "scheduled_at" < '${window.end.toISOString()}'`,
        ),
      );
    }
    await tx.execute(
      sql.raw(
        'ALTER TABLE "hub_probe_runs" ATTACH PARTITION "hub_probe_runs_default" DEFAULT',
      ),
    );
  });
  return windows.map((window) => window.name);
}

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
  await ensureHubProbeRunPartitions(db, options.now);
  const { checksBefore, bucketsBefore } = getRetentionCutoffs(options.now);
  const batchSize = Math.max(
    1,
    options.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE,
  );
  const checksBeforeIso = checksBefore.toISOString();
  const bucketsBeforeIso = bucketsBefore.toISOString();
  let deletedChecks = 0;
  let deletedBuckets = 0;
  let deletedHubProbeRuns = 0;
  let deletedHubProbeCycles = 0;
  let deletedHubBuckets = 0;

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
      targetId: string;
      probeCycleId: string;
      attemptNo: number;
      scheduledAt: Date;
    }>(sql`
      WITH doomed AS (
        SELECT
          ${hubProbeRuns.targetId},
          ${hubProbeRuns.probeCycleId},
          ${hubProbeRuns.attemptNo},
          ${hubProbeRuns.scheduledAt}
        FROM ${hubProbeRuns}
        WHERE ${hubProbeRuns.scheduledAt} < ${checksBeforeIso}
        ORDER BY ${hubProbeRuns.scheduledAt}
        LIMIT ${batchSize}
      )
      DELETE FROM ${hubProbeRuns}
      USING doomed
      WHERE ${hubProbeRuns.targetId} = doomed.target_id
        AND ${hubProbeRuns.probeCycleId} = doomed.probe_cycle_id
        AND ${hubProbeRuns.attemptNo} = doomed.attempt_no
        AND ${hubProbeRuns.scheduledAt} = doomed.scheduled_at
      RETURNING
        ${hubProbeRuns.targetId},
        ${hubProbeRuns.probeCycleId},
        ${hubProbeRuns.attemptNo},
        ${hubProbeRuns.scheduledAt}
    `);
    deletedHubProbeRuns += rows.length;
    if (rows.length < batchSize) break;
  }

  while (true) {
    const rows = await db.execute<{ id: string }>(sql`
      WITH doomed AS (
        SELECT ${hubProbeCycles.id}
        FROM ${hubProbeCycles}
        WHERE ${hubProbeCycles.scheduledAt} < ${checksBeforeIso}
          AND NOT EXISTS (
            SELECT 1
            FROM ${hubProbeRuns}
            WHERE ${hubProbeRuns.probeCycleId} = ${hubProbeCycles.id}
          )
        ORDER BY ${hubProbeCycles.scheduledAt}
        LIMIT ${batchSize}
      )
      DELETE FROM ${hubProbeCycles}
      WHERE ${hubProbeCycles.id} IN (SELECT id FROM doomed)
      RETURNING ${hubProbeCycles.id}
    `);
    deletedHubProbeCycles += rows.length;
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

  while (true) {
    const rows = await db.execute<{
      groupModelId: string;
      bucketStart: Date;
    }>(sql`
      WITH doomed AS (
        SELECT ${hubHealthBuckets3h.groupModelId}, ${hubHealthBuckets3h.bucketStart}
        FROM ${hubHealthBuckets3h}
        WHERE ${hubHealthBuckets3h.bucketStart} < ${bucketsBeforeIso}
        ORDER BY ${hubHealthBuckets3h.bucketStart}
        LIMIT ${batchSize}
      )
      DELETE FROM ${hubHealthBuckets3h}
      USING doomed
      WHERE ${hubHealthBuckets3h.groupModelId} = doomed.group_model_id
        AND ${hubHealthBuckets3h.bucketStart} = doomed.bucket_start
      RETURNING ${hubHealthBuckets3h.groupModelId}, ${hubHealthBuckets3h.bucketStart}
    `);
    deletedHubBuckets += rows.length;
    if (rows.length < batchSize) break;
  }

  return {
    checksBefore,
    bucketsBefore,
    deletedChecks,
    deletedBuckets,
    deletedHubProbeRuns,
    deletedHubProbeCycles,
    deletedHubBuckets,
  };
}
