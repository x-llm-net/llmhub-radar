import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  hubGroupModels,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubModels,
  hubConfigOutbox,
  hubProviderGroups,
  hubRelayChannelBindings,
} from "./schema";

export type HubConfigAction = "upsert" | "disable";

export type ClaimedHubConfigTask = {
  id: string;
  groupId: string;
  configVersion: number;
  action: HubConfigAction;
  attempts: number;
  leaseUntil: Date;
  stale: boolean;
};

export class HubConfigLeaseError extends Error {
  constructor() {
    super("Hub config task lease is no longer owned by this worker");
    this.name = "HubConfigLeaseError";
  }
}

export type HubRelayProjectionSource = {
  groupId: string;
  configVersion: number;
  lifecycleStatus: "draft" | "verifying" | "ready" | "retired";
  desiredStatus: "active" | "paused" | "retired";
  listingStatus: "private" | "pending" | "listed" | "delisted";
  baseUrlCiphertext: string;
  apiKeyCiphertext: string;
  multiplierBps: number | null;
  models: Array<{
    groupModelId: string;
    canonicalModel: string;
    upstreamModel: string;
    baseUrlOverrideCiphertext: string | null;
  }>;
};

export async function getHubRelayProjectionSource(
  db: MarketplaceDb,
  groupId: string,
): Promise<HubRelayProjectionSource | null> {
  const [group] = await db
    .select({
      groupId: hubProviderGroups.id,
      configVersion: hubProviderGroups.configVersion,
      lifecycleStatus: hubProviderGroups.lifecycleStatus,
      desiredStatus: hubProviderGroups.desiredStatus,
      listingStatus: hubProviderGroups.listingStatus,
      baseUrlCiphertext: hubProviderGroups.baseUrlCiphertext,
      apiKeyCiphertext: hubGroupSecrets.apiKeyCiphertext,
    })
    .from(hubProviderGroups)
    .innerJoin(
      hubGroupSecrets,
      eq(hubGroupSecrets.groupId, hubProviderGroups.id),
    )
    .where(eq(hubProviderGroups.id, groupId))
    .limit(1);
  if (!group) return null;
  const now = new Date();
  const [price] = await db
    .select({ multiplierBps: hubGroupPriceVersions.multiplierBps })
    .from(hubGroupPriceVersions)
    .where(
      and(
        eq(hubGroupPriceVersions.groupId, groupId),
        lte(hubGroupPriceVersions.effectiveFrom, now),
        or(
          isNull(hubGroupPriceVersions.effectiveTo),
          gt(hubGroupPriceVersions.effectiveTo, now),
        ),
      ),
    )
    .orderBy(asc(hubGroupPriceVersions.effectiveFrom))
    .limit(1);

  const models = await db
    .select({
      groupModelId: hubGroupModels.id,
      canonicalModel: hubModels.canonicalName,
      upstreamModel: hubGroupModels.upstreamModelName,
      baseUrlOverrideCiphertext: hubGroupModels.baseUrlOverrideCiphertext,
    })
    .from(hubGroupModels)
    .innerJoin(hubModels, eq(hubModels.id, hubGroupModels.modelId))
    .where(
      and(
        eq(hubGroupModels.groupId, groupId),
        eq(hubGroupModels.discoveryStatus, "active"),
        eq(hubGroupModels.trafficEnabled, true),
      ),
    )
    .orderBy(
      asc(hubModels.canonicalName),
      asc(hubGroupModels.upstreamModelName),
    );

  return { ...group, multiplierBps: price?.multiplierBps ?? null, models };
}

export async function claimDueHubConfigTasks(
  db: MarketplaceDb,
  options: { limit?: number; now?: Date; leaseMs?: number } = {},
): Promise<ClaimedHubConfigTask[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const leaseMs = Math.max(1_000, options.leaseMs ?? 60_000);
  const leaseUntil = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: hubConfigOutbox.id,
        groupId: hubConfigOutbox.groupId,
        configVersion: hubConfigOutbox.configVersion,
        action: hubConfigOutbox.action,
        attempts: hubConfigOutbox.attempts,
        currentConfigVersion: hubProviderGroups.configVersion,
      })
      .from(hubConfigOutbox)
      .innerJoin(
        hubProviderGroups,
        eq(hubProviderGroups.id, hubConfigOutbox.groupId),
      )
      .where(
        and(
          lte(hubConfigOutbox.nextAttemptAt, now),
          or(
            inArray(hubConfigOutbox.status, ["pending", "failed"]),
            and(
              eq(hubConfigOutbox.status, "processing"),
              or(
                isNull(hubConfigOutbox.lockedUntil),
                lte(hubConfigOutbox.lockedUntil, now),
              ),
            ),
          ),
        ),
      )
      .orderBy(
        asc(hubConfigOutbox.nextAttemptAt),
        asc(hubConfigOutbox.createdAt),
      )
      .limit(limit)
      .for("update", { of: hubConfigOutbox, skipLocked: true });

    const claims: ClaimedHubConfigTask[] = [];
    for (const row of rows) {
      const attempts = row.attempts + 1;
      await tx
        .update(hubConfigOutbox)
        .set({
          status: "processing",
          attempts,
          lockedUntil: leaseUntil,
          updatedAt: now,
        })
        .where(eq(hubConfigOutbox.id, row.id));
      claims.push({
        id: row.id,
        groupId: row.groupId,
        configVersion: row.configVersion,
        action: asHubConfigAction(row.action),
        attempts,
        leaseUntil,
        stale: row.configVersion < row.currentConfigVersion,
      });
    }
    return claims;
  });
}

export async function isHubConfigTaskStale(
  db: MarketplaceDb,
  task: Pick<ClaimedHubConfigTask, "groupId" | "configVersion">,
) {
  const [group] = await db
    .select({ configVersion: hubProviderGroups.configVersion })
    .from(hubProviderGroups)
    .where(eq(hubProviderGroups.id, task.groupId))
    .limit(1);
  if (!group) return true;
  return task.configVersion < group.configVersion;
}

export async function markHubConfigTaskApplied(
  db: MarketplaceDb,
  task: Pick<ClaimedHubConfigTask, "id" | "attempts" | "leaseUntil">,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const [updated] = await db
    .update(hubConfigOutbox)
    .set({
      status: "applied",
      lockedUntil: null,
      lastError: null,
      appliedAt: sql`coalesce(
        ${hubConfigOutbox.appliedAt},
        ${now.toISOString()}::timestamptz
      )`,
      updatedAt: now,
    })
    .where(
      and(
        eq(hubConfigOutbox.id, task.id),
        eq(hubConfigOutbox.attempts, task.attempts),
        or(
          eq(hubConfigOutbox.status, "applied"),
          and(
            eq(hubConfigOutbox.status, "processing"),
            eq(hubConfigOutbox.lockedUntil, task.leaseUntil),
            gt(hubConfigOutbox.lockedUntil, now),
          ),
        ),
      ),
    )
    .returning({ id: hubConfigOutbox.id });
  if (!updated) throw new HubConfigLeaseError();
  return { id: updated.id };
}

export async function markHubConfigTaskFailed(
  db: MarketplaceDb,
  task: Pick<ClaimedHubConfigTask, "id" | "attempts" | "leaseUntil">,
  error: unknown,
  options: { now?: Date; baseDelayMs?: number; maxDelayMs?: number } = {},
) {
  const now = options.now ?? new Date();
  const delayMs = calculateHubConfigRetryDelayMs(task.attempts, options);
  const nextAttemptAt = new Date(now.getTime() + delayMs);
  const [updated] = await db
    .update(hubConfigOutbox)
    .set({
      status: "failed",
      lockedUntil: null,
      lastError: safeErrorMessage(error),
      nextAttemptAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(hubConfigOutbox.id, task.id),
        eq(hubConfigOutbox.status, "processing"),
        eq(hubConfigOutbox.attempts, task.attempts),
        eq(hubConfigOutbox.lockedUntil, task.leaseUntil),
        gt(hubConfigOutbox.lockedUntil, now),
      ),
    )
    .returning({ id: hubConfigOutbox.id });
  if (!updated) throw new HubConfigLeaseError();
  return { id: updated.id, nextAttemptAt, delayMs };
}

export function calculateHubConfigRetryDelayMs(
  attempts: number,
  options: { baseDelayMs?: number; maxDelayMs?: number } = {},
) {
  const baseDelayMs = Math.max(1_000, options.baseDelayMs ?? 5_000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 60 * 60_000);
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

export async function upsertHubRelayChannelBinding(
  db: MarketplaceDb,
  input: {
    groupId: string;
    routeKey: string;
    externalChannelId: string;
    configVersion: number;
    configChecksum: string;
    active?: boolean;
    now?: Date;
  },
) {
  return db.transaction(async (tx) => {
    const now = input.now ?? new Date();
    const [group] = await tx
      .select({ configVersion: hubProviderGroups.configVersion })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, input.groupId))
      .limit(1)
      .for("update");
    if (!group) throw new Error("Hub provider group not found");
    if (input.configVersion < group.configVersion) {
      return { status: "stale" as const, binding: null };
    }
    if (input.configVersion > group.configVersion) {
      throw new Error("Hub relay binding config version is ahead of its group");
    }

    const [existing] = await tx
      .select()
      .from(hubRelayChannelBindings)
      .where(
        and(
          eq(hubRelayChannelBindings.groupId, input.groupId),
          eq(hubRelayChannelBindings.routeKey, input.routeKey),
        ),
      )
      .limit(1)
      .for("update");
    if (existing && existing.appliedConfigVersion > input.configVersion) {
      return { status: "stale" as const, binding: existing };
    }

    const active = input.active ?? true;
    if (
      existing &&
      existing.externalChannelId === input.externalChannelId &&
      existing.appliedConfigVersion === input.configVersion &&
      existing.configChecksum === input.configChecksum &&
      existing.active === active
    ) {
      return { status: "unchanged" as const, binding: existing };
    }

    if (existing) {
      const [binding] = await tx
        .update(hubRelayChannelBindings)
        .set({
          externalChannelId: input.externalChannelId,
          appliedConfigVersion: input.configVersion,
          configChecksum: input.configChecksum,
          active,
          updatedAt: now,
        })
        .where(eq(hubRelayChannelBindings.id, existing.id))
        .returning();
      return { status: "applied" as const, binding: binding ?? existing };
    }

    const [binding] = await tx
      .insert(hubRelayChannelBindings)
      .values({
        groupId: input.groupId,
        routeKey: input.routeKey,
        externalChannelId: input.externalChannelId,
        appliedConfigVersion: input.configVersion,
        configChecksum: input.configChecksum,
        active,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!binding) throw new Error("Failed to create hub relay binding");
    return { status: "applied" as const, binding };
  });
}

export async function deactivateHubRelayChannelBindings(
  db: MarketplaceDb,
  input: {
    groupId: string;
    configVersion: number;
    routeKeys?: readonly string[];
    now?: Date;
  },
) {
  if (input.routeKeys && input.routeKeys.length === 0) {
    return { status: "unchanged" as const, count: 0 };
  }

  return db.transaction(async (tx) => {
    const now = input.now ?? new Date();
    const [group] = await tx
      .select({ configVersion: hubProviderGroups.configVersion })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, input.groupId))
      .limit(1)
      .for("update");
    if (!group) throw new Error("Hub provider group not found");
    if (input.configVersion < group.configVersion) {
      return { status: "stale" as const, count: 0 };
    }
    if (input.configVersion > group.configVersion) {
      throw new Error("Hub relay binding config version is ahead of its group");
    }

    const predicates = [
      eq(hubRelayChannelBindings.groupId, input.groupId),
      eq(hubRelayChannelBindings.active, true),
      lte(hubRelayChannelBindings.appliedConfigVersion, input.configVersion),
    ];
    if (input.routeKeys) {
      predicates.push(
        inArray(hubRelayChannelBindings.routeKey, [...input.routeKeys]),
      );
    }
    const updated = await tx
      .update(hubRelayChannelBindings)
      .set({
        active: false,
        appliedConfigVersion: input.configVersion,
        updatedAt: now,
      })
      .where(and(...predicates))
      .returning({ id: hubRelayChannelBindings.id });
    return {
      status:
        updated.length === 0 ? ("unchanged" as const) : ("applied" as const),
      count: updated.length,
    };
  });
}

export async function listHubRelayChannelBindings(
  db: MarketplaceDb,
  groupId: string,
) {
  return db
    .select()
    .from(hubRelayChannelBindings)
    .where(eq(hubRelayChannelBindings.groupId, groupId))
    .orderBy(asc(hubRelayChannelBindings.routeKey));
}

export async function setHubGroupModelRelayBinding(
  db: MarketplaceDb,
  input: { groupModelIds: readonly string[]; relayChannelBindingId: string },
) {
  if (input.groupModelIds.length === 0) return 0;
  const updated = await db
    .update(hubGroupModels)
    .set({
      relayChannelBindingId: input.relayChannelBindingId,
      updatedAt: new Date(),
    })
    .where(inArray(hubGroupModels.id, [...input.groupModelIds]))
    .returning({ id: hubGroupModels.id });
  return updated.length;
}

export async function clearHubGroupModelRelayBinding(
  db: MarketplaceDb,
  relayChannelBindingId: string,
) {
  const updated = await db
    .update(hubGroupModels)
    .set({ relayChannelBindingId: null, updatedAt: new Date() })
    .where(eq(hubGroupModels.relayChannelBindingId, relayChannelBindingId))
    .returning({ id: hubGroupModels.id });
  return updated.length;
}

function asHubConfigAction(value: string): HubConfigAction {
  if (value === "upsert" || value === "disable") return value;
  throw new Error(`Unsupported hub config action: ${value}`);
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}
