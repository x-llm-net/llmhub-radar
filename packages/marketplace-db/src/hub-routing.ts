import { createHash, randomBytes } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  hubApiTokens,
  hubBillingAuthorizations,
  hubGroupBlocks,
  hubGroupModels,
  hubGroupModelStats,
  hubModels,
  hubProviderGroups,
  hubProviders,
  hubModelAliases,
  hubRelayChannelBindings,
  hubRequests,
  hubRequestAttempts,
  hubTokenGroupPreferences,
  hubUsageRecords,
} from "./schema";

const TOKEN_PREFIX = "lh_";
const MAX_ROUTE_CANDIDATES = 10;

type MarketplaceTx = Parameters<Parameters<MarketplaceDb["transaction"]>[0]>[0];
type MarketplaceExecutor = MarketplaceDb | MarketplaceTx;

export type HubApiTokenSummary = {
  id: string;
  ownerUserId: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  routingRevision: number;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type HubTokenPreference = {
  groupId: string;
  providerName: string;
  groupName: string;
  priority: number;
  weight: number;
  enabled: boolean;
  updatedAt: Date;
};

export type HubAvailableGroup = {
  groupId: string;
  providerName: string;
  groupName: string;
  description: string;
  balanceStatus: "unknown" | "available" | "low" | "exhausted" | "error";
};

export type HubRoutePlanItem = {
  groupModelId: string;
  relayChannelBindingId: string;
  externalChannelId: string;
  upstreamModel: string;
  configVersion: number;
};

export type HubRouteCandidate = HubRoutePlanItem & {
  groupId: string;
  providerName: string;
  groupName: string;
};

export type HubUserRequestActivity = {
  requestId: string;
  status: "planned" | "running" | "succeeded" | "failed";
  tokenId: string;
  tokenName: string;
  modelName: string;
  providerName: string | null;
  groupName: string | null;
  attemptCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  chargedAmountMicros: string | null;
  billingStatus: "reserved" | "captured" | "released" | "expired" | null;
  currency: string;
  createdAt: Date;
  completedAt: Date | null;
};

export class HubRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubRoutingError";
  }
}

export class HubApiTokenNotFoundError extends HubRoutingError {
  constructor() {
    super("API token not found");
    this.name = "HubApiTokenNotFoundError";
  }
}

export class HubApiTokenRevokedError extends HubRoutingError {
  constructor() {
    super("API token is revoked or expired");
    this.name = "HubApiTokenRevokedError";
  }
}

export class HubRouteUnavailableError extends HubRoutingError {
  constructor(model: string) {
    super(`No active route is available for model: ${model}`);
    this.name = "HubRouteUnavailableError";
  }
}

export function hashHubApiToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateHubApiToken() {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    prefix: token.slice(0, 12),
    tokenHash: hashHubApiToken(token),
  };
}

export async function createHubApiToken(
  db: MarketplaceDb,
  input: {
    ownerUserId: string;
    name: string;
    expiresAt?: Date | null;
    now?: Date;
  },
) {
  const ownerUserId = input.ownerUserId.trim();
  const name = input.name.trim();
  if (!ownerUserId || !name) {
    throw new HubRoutingError("Token owner and name are required");
  }
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new HubRoutingError("Token expiry must be in the future");
  }

  const now = input.now ?? new Date();
  const generated = generateHubApiToken();
  const [created] = await db
    .insert(hubApiTokens)
    .values({
      ownerUserId,
      name,
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error("Failed to create API token");

  return {
    token: generated.token,
    ...toHubApiTokenSummary(created),
  };
}

export async function listHubApiTokens(
  db: MarketplaceExecutor,
  ownerUserId: string,
) {
  const rows = await db
    .select()
    .from(hubApiTokens)
    .where(eq(hubApiTokens.ownerUserId, ownerUserId.trim()))
    .orderBy(desc(hubApiTokens.createdAt));
  return rows.map(toHubApiTokenSummary);
}

export async function revokeHubApiToken(
  db: MarketplaceDb,
  input: { ownerUserId: string; tokenId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const [updated] = await db
    .update(hubApiTokens)
    .set({
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
      routingRevision: sql`${hubApiTokens.routingRevision} + 1`,
    })
    .where(
      and(
        eq(hubApiTokens.id, input.tokenId),
        eq(hubApiTokens.ownerUserId, input.ownerUserId.trim()),
        eq(hubApiTokens.status, "active"),
      ),
    )
    .returning();
  if (!updated) throw new HubApiTokenNotFoundError();
  return toHubApiTokenSummary(updated);
}

export async function authenticateHubApiToken(
  db: MarketplaceDb,
  token: string,
  options: { now?: Date } = {},
) {
  const supplied = token.trim();
  if (!supplied) return null;
  const [row] = await db
    .select()
    .from(hubApiTokens)
    .where(eq(hubApiTokens.tokenHash, hashHubApiToken(supplied)))
    .limit(1);
  if (!row) return null;

  const now = options.now ?? new Date();
  if (
    row.status !== "active" ||
    (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
  ) {
    return null;
  }

  await db
    .update(hubApiTokens)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(and(eq(hubApiTokens.id, row.id), eq(hubApiTokens.status, "active")));
  return toHubApiTokenSummary({ ...row, lastUsedAt: now });
}

export async function listHubTokenGroupPreferences(
  db: MarketplaceExecutor,
  input: { ownerUserId: string; tokenId: string },
) {
  const rows = await db
    .select({
      groupId: hubTokenGroupPreferences.groupId,
      providerName: hubProviders.displayName,
      groupName: hubProviderGroups.name,
      priority: hubTokenGroupPreferences.priority,
      weight: hubTokenGroupPreferences.weight,
      enabled: hubTokenGroupPreferences.enabled,
      updatedAt: hubTokenGroupPreferences.updatedAt,
    })
    .from(hubTokenGroupPreferences)
    .innerJoin(
      hubApiTokens,
      eq(hubApiTokens.id, hubTokenGroupPreferences.tokenId),
    )
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubTokenGroupPreferences.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(
      and(
        eq(hubTokenGroupPreferences.tokenId, input.tokenId),
        eq(hubApiTokens.ownerUserId, input.ownerUserId.trim()),
      ),
    )
    .orderBy(
      asc(hubTokenGroupPreferences.priority),
      desc(hubTokenGroupPreferences.weight),
    );
  return rows;
}

export async function listHubAvailableGroups(db: MarketplaceExecutor) {
  const rows = await db
    .select({
      groupId: hubProviderGroups.id,
      providerName: hubProviders.displayName,
      groupName: hubProviderGroups.name,
      description: hubProviderGroups.description,
      balanceStatus: hubProviderGroups.balanceStatus,
    })
    .from(hubProviderGroups)
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(
      and(
        eq(hubProviderGroups.lifecycleStatus, "ready"),
        eq(hubProviderGroups.desiredStatus, "active"),
        eq(hubProviderGroups.listingStatus, "listed"),
        ne(hubProviderGroups.balanceStatus, "exhausted"),
        not(
          exists(
            db
              .select({ id: hubGroupBlocks.id })
              .from(hubGroupBlocks)
              .where(
                and(
                  eq(hubGroupBlocks.groupId, hubProviderGroups.id),
                  isNull(hubGroupBlocks.resolvedAt),
                  eq(hubGroupBlocks.stopsTraffic, true),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(hubProviders.displayName), asc(hubProviderGroups.name));
  return rows;
}

export async function replaceHubTokenGroupPreferences(
  db: MarketplaceDb,
  input: {
    ownerUserId: string;
    tokenId: string;
    preferences: Array<{
      groupId: string;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }>;
    now?: Date;
  },
) {
  const uniqueGroupIds = [
    ...new Set(input.preferences.map((item) => item.groupId)),
  ];
  if (uniqueGroupIds.length !== input.preferences.length) {
    throw new HubRoutingError("A token can subscribe to each group only once");
  }
  if (uniqueGroupIds.length > 100) {
    throw new HubRoutingError("A token can subscribe to at most 100 groups");
  }
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [token] = await tx
      .select({ id: hubApiTokens.id, status: hubApiTokens.status })
      .from(hubApiTokens)
      .where(
        and(
          eq(hubApiTokens.id, input.tokenId),
          eq(hubApiTokens.ownerUserId, input.ownerUserId.trim()),
        ),
      )
      .limit(1)
      .for("update");
    if (!token) throw new HubApiTokenNotFoundError();
    if (token.status !== "active") throw new HubApiTokenRevokedError();

    if (uniqueGroupIds.length > 0) {
      const eligible = await tx
        .select({ id: hubProviderGroups.id })
        .from(hubProviderGroups)
        .where(
          and(
            inArray(hubProviderGroups.id, uniqueGroupIds),
            eq(hubProviderGroups.lifecycleStatus, "ready"),
            eq(hubProviderGroups.desiredStatus, "active"),
            eq(hubProviderGroups.listingStatus, "listed"),
            ne(hubProviderGroups.balanceStatus, "exhausted"),
          ),
        );
      if (eligible.length !== uniqueGroupIds.length) {
        throw new HubRoutingError(
          "Only active and listed groups can be subscribed",
        );
      }
    }

    await tx
      .delete(hubTokenGroupPreferences)
      .where(eq(hubTokenGroupPreferences.tokenId, input.tokenId));
    if (input.preferences.length > 0) {
      await tx.insert(hubTokenGroupPreferences).values(
        input.preferences.map((preference) => ({
          tokenId: input.tokenId,
          groupId: preference.groupId,
          priority: Math.max(0, Math.floor(preference.priority ?? 0)),
          weight: Math.max(0, Math.floor(preference.weight ?? 100)),
          enabled: preference.enabled ?? true,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    await tx
      .update(hubApiTokens)
      .set({
        routingRevision: sql`${hubApiTokens.routingRevision} + 1`,
        updatedAt: now,
      })
      .where(eq(hubApiTokens.id, input.tokenId));

    return listHubTokenGroupPreferences(tx, input);
  });
}

export async function findHubCanonicalModel(
  db: MarketplaceExecutor,
  modelName: string,
) {
  const normalized = normalizeModelName(modelName);
  const [model] = await db
    .select({ id: hubModels.id, canonicalName: hubModels.canonicalName })
    .from(hubModels)
    .leftJoin(
      hubModelAliases,
      and(
        eq(hubModelAliases.modelId, hubModels.id),
        eq(hubModelAliases.normalizedAlias, normalized),
      ),
    )
    .where(
      and(
        ne(hubModels.status, "retired"),
        or(
          sql`lower(${hubModels.canonicalName}) = ${normalized}`,
          eq(hubModelAliases.normalizedAlias, normalized),
        ),
      ),
    )
    .limit(1);
  return model ?? null;
}

export async function planHubRoute(
  db: MarketplaceDb,
  input: { tokenId: string; model: string; maxCandidates?: number },
) {
  const model = await findHubCanonicalModel(db, input.model);
  if (!model) throw new HubRouteUnavailableError(input.model);

  const maxCandidates = Math.max(
    1,
    Math.min(input.maxCandidates ?? MAX_ROUTE_CANDIDATES, MAX_ROUTE_CANDIDATES),
  );
  const rows = await db
    .select({
      groupModelId: hubGroupModels.id,
      groupId: hubProviderGroups.id,
      providerName: hubProviders.displayName,
      groupName: hubProviderGroups.name,
      upstreamModel: hubGroupModels.upstreamModelName,
      configVersion: hubProviderGroups.configVersion,
      relayChannelBindingId: hubRelayChannelBindings.id,
      externalChannelId: hubRelayChannelBindings.externalChannelId,
      subscribed: sql<boolean>`(${hubTokenGroupPreferences.tokenId} IS NOT NULL)`,
      priority: hubTokenGroupPreferences.priority,
      weight: hubTokenGroupPreferences.weight,
      currentStatus: hubGroupModelStats.currentStatus,
      rankingScoreBps: hubGroupModelStats.rankingScoreBps,
      firstTokenP50Ms: hubGroupModelStats.firstTokenP50Ms,
    })
    .from(hubGroupModels)
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .leftJoin(
      hubGroupModelStats,
      eq(hubGroupModelStats.groupModelId, hubGroupModels.id),
    )
    .innerJoin(
      hubRelayChannelBindings,
      and(
        eq(hubGroupModels.relayChannelBindingId, hubRelayChannelBindings.id),
        eq(hubRelayChannelBindings.groupId, hubProviderGroups.id),
        eq(hubRelayChannelBindings.active, true),
        eq(
          hubRelayChannelBindings.appliedConfigVersion,
          hubProviderGroups.configVersion,
        ),
      ),
    )
    .leftJoin(
      hubTokenGroupPreferences,
      and(
        eq(hubTokenGroupPreferences.groupId, hubProviderGroups.id),
        eq(hubTokenGroupPreferences.tokenId, input.tokenId),
        eq(hubTokenGroupPreferences.enabled, true),
      ),
    )
    .where(
      and(
        eq(hubGroupModels.modelId, model.id),
        eq(hubGroupModels.discoveryStatus, "active"),
        eq(hubGroupModels.trafficEnabled, true),
        eq(hubProviders.status, "active"),
        eq(hubProviderGroups.lifecycleStatus, "ready"),
        eq(hubProviderGroups.desiredStatus, "active"),
        eq(hubProviderGroups.listingStatus, "listed"),
        ne(hubProviderGroups.balanceStatus, "exhausted"),
        not(
          exists(
            db
              .select({ id: hubGroupBlocks.id })
              .from(hubGroupBlocks)
              .where(
                and(
                  eq(hubGroupBlocks.groupId, hubProviderGroups.id),
                  isNull(hubGroupBlocks.resolvedAt),
                  eq(hubGroupBlocks.stopsTraffic, true),
                ),
              ),
          ),
        ),
      ),
    );

  const deduplicated = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!deduplicated.has(row.groupModelId))
      deduplicated.set(row.groupModelId, row);
  }
  const candidates = [...deduplicated.values()].sort((left, right) => {
    if (left.subscribed !== right.subscribed) return left.subscribed ? -1 : 1;
    const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
    return (
      leftPriority - rightPriority ||
      (right.weight ?? 0) - (left.weight ?? 0) ||
      healthRank(left.currentStatus) - healthRank(right.currentStatus) ||
      (right.rankingScoreBps ?? -1) - (left.rankingScoreBps ?? -1) ||
      (left.firstTokenP50Ms ?? Number.MAX_SAFE_INTEGER) -
        (right.firstTokenP50Ms ?? Number.MAX_SAFE_INTEGER) ||
      left.groupModelId.localeCompare(right.groupModelId)
    );
  });

  const subscribed = candidates.filter((candidate) => candidate.subscribed);
  const publicPool = candidates.filter((candidate) => !candidate.subscribed);
  const selected =
    maxCandidates > 1 && subscribed.length >= maxCandidates && publicPool[0]
      ? [...subscribed.slice(0, maxCandidates - 1), publicPool[0]]
      : [...subscribed, ...publicPool].slice(0, maxCandidates);

  return {
    model,
    candidates: selected.map((candidate) => ({
      groupModelId: candidate.groupModelId,
      relayChannelBindingId: candidate.relayChannelBindingId,
      externalChannelId: candidate.externalChannelId,
      upstreamModel: candidate.upstreamModel,
      configVersion: candidate.configVersion,
      groupId: candidate.groupId,
      providerName: candidate.providerName,
      groupName: candidate.groupName,
    })),
  };
}

export async function getCurrentHubRouteCandidate(
  db: MarketplaceDb,
  candidate: HubRoutePlanItem,
) {
  const [row] = await db
    .select({
      groupModelId: hubGroupModels.id,
      groupId: hubProviderGroups.id,
      providerName: hubProviders.displayName,
      groupName: hubProviderGroups.name,
      upstreamModel: hubGroupModels.upstreamModelName,
      configVersion: hubProviderGroups.configVersion,
      relayChannelBindingId: hubRelayChannelBindings.id,
      externalChannelId: hubRelayChannelBindings.externalChannelId,
    })
    .from(hubGroupModels)
    .innerJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .innerJoin(
      hubRelayChannelBindings,
      and(
        eq(hubRelayChannelBindings.id, candidate.relayChannelBindingId),
        eq(hubGroupModels.relayChannelBindingId, hubRelayChannelBindings.id),
        eq(hubRelayChannelBindings.groupId, hubProviderGroups.id),
      ),
    )
    .where(
      and(
        eq(hubGroupModels.id, candidate.groupModelId),
        eq(hubGroupModels.discoveryStatus, "active"),
        eq(hubGroupModels.trafficEnabled, true),
        eq(hubProviders.status, "active"),
        eq(hubProviderGroups.lifecycleStatus, "ready"),
        eq(hubProviderGroups.desiredStatus, "active"),
        eq(hubProviderGroups.listingStatus, "listed"),
        ne(hubProviderGroups.balanceStatus, "exhausted"),
        eq(hubProviderGroups.configVersion, candidate.configVersion),
        eq(
          hubRelayChannelBindings.externalChannelId,
          candidate.externalChannelId,
        ),
        eq(
          hubRelayChannelBindings.appliedConfigVersion,
          candidate.configVersion,
        ),
        eq(hubRelayChannelBindings.active, true),
        not(
          exists(
            db
              .select({ id: hubGroupBlocks.id })
              .from(hubGroupBlocks)
              .where(
                and(
                  eq(hubGroupBlocks.groupId, hubProviderGroups.id),
                  isNull(hubGroupBlocks.resolvedAt),
                  eq(hubGroupBlocks.stopsTraffic, true),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

function healthRank(status: string | null) {
  switch (status) {
    case "normal":
      return 0;
    case "degraded":
      return 1;
    case "unknown":
    case null:
      return 2;
    case "stale":
      return 3;
    case "down":
      return 4;
    case "configuration_error":
      return 5;
    default:
      return 6;
  }
}

export async function listHubUserRequestActivity(
  db: MarketplaceExecutor,
  input: { ownerUserId: string; limit?: number },
): Promise<HubUserRequestActivity[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = await db
    .select({
      requestId: hubRequests.id,
      status: hubRequests.status,
      tokenId: hubApiTokens.id,
      tokenName: hubApiTokens.name,
      modelName: hubModels.displayName,
      providerName: hubProviders.name,
      groupName: hubProviderGroups.name,
      attemptCount: count(hubRequestAttempts.id),
      inputTokens: hubUsageRecords.inputTokens,
      outputTokens: hubUsageRecords.outputTokens,
      cacheReadTokens: hubUsageRecords.cacheReadTokens,
      cacheWriteTokens: hubUsageRecords.cacheWriteTokens,
      chargedAmountMicros: hubUsageRecords.userAmountMicros,
      usageCurrency: hubUsageRecords.currency,
      authorizationStatus: hubBillingAuthorizations.status,
      authorizationCurrency: hubBillingAuthorizations.currency,
      createdAt: hubRequests.createdAt,
      completedAt: hubRequests.completedAt,
    })
    .from(hubRequests)
    .innerJoin(hubApiTokens, eq(hubApiTokens.id, hubRequests.tokenId))
    .innerJoin(hubModels, eq(hubModels.id, hubRequests.canonicalModelId))
    .leftJoin(
      hubRequestAttempts,
      eq(hubRequestAttempts.requestId, hubRequests.id),
    )
    .leftJoin(
      hubGroupModels,
      eq(hubGroupModels.id, hubRequests.finalGroupModelId),
    )
    .leftJoin(
      hubProviderGroups,
      eq(hubProviderGroups.id, hubGroupModels.groupId),
    )
    .leftJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .leftJoin(hubUsageRecords, eq(hubUsageRecords.requestId, hubRequests.id))
    .leftJoin(
      hubBillingAuthorizations,
      eq(hubBillingAuthorizations.requestId, hubRequests.id),
    )
    .where(eq(hubRequests.ownerUserId, input.ownerUserId))
    .groupBy(
      hubRequests.id,
      hubApiTokens.id,
      hubModels.id,
      hubProviders.id,
      hubProviderGroups.id,
      hubUsageRecords.id,
      hubBillingAuthorizations.id,
    )
    .orderBy(desc(hubRequests.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    requestId: row.requestId,
    status: row.status,
    tokenId: row.tokenId,
    tokenName: row.tokenName,
    modelName: row.modelName,
    providerName: row.providerName,
    groupName: row.groupName,
    attemptCount: row.attemptCount,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    cacheWriteTokens: row.cacheWriteTokens ?? 0,
    chargedAmountMicros: row.chargedAmountMicros?.toString() ?? null,
    billingStatus: row.authorizationStatus,
    currency: row.usageCurrency ?? row.authorizationCurrency ?? "USD",
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }));
}

export async function createHubRequest(
  db: MarketplaceDb,
  input: {
    ownerUserId: string;
    tokenId: string;
    canonicalModelId: string;
    routePlan: HubRoutePlanItem[];
    routePlanVersion?: number;
    now?: Date;
  },
) {
  if (input.routePlan.length === 0) {
    throw new HubRouteUnavailableError("unknown");
  }
  const now = input.now ?? new Date();
  const [request] = await db
    .insert(hubRequests)
    .values({
      ownerUserId: input.ownerUserId,
      tokenId: input.tokenId,
      canonicalModelId: input.canonicalModelId,
      routePlanVersion: input.routePlanVersion ?? 1,
      routePlan: input.routePlan,
      status: "running",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: hubRequests.id, createdAt: hubRequests.createdAt });
  if (!request) throw new Error("Failed to create hub request");
  return request;
}

export async function recordHubRequestAttempt(
  db: MarketplaceDb,
  input: {
    requestId: string;
    attemptNo: number;
    candidate: HubRoutePlanItem;
    outcome: "success" | "provider_failure" | "configuration_error" | "aborted";
    errorCode?: string | null;
    upstreamRequestId?: string | null;
    startedAt: Date;
    completedAt: Date;
  },
) {
  const [attempt] = await db
    .insert(hubRequestAttempts)
    .values({
      requestId: input.requestId,
      attemptNo: input.attemptNo,
      groupModelId: input.candidate.groupModelId,
      relayChannelBindingId: input.candidate.relayChannelBindingId,
      externalChannelId: input.candidate.externalChannelId,
      configVersion: input.candidate.configVersion,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      upstreamRequestId: input.upstreamRequestId ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      createdAt: input.completedAt,
      updatedAt: input.completedAt,
    })
    .returning();
  if (!attempt) throw new Error("Failed to record hub request attempt");
  return attempt;
}

export async function finishHubRequest(
  db: MarketplaceDb,
  input: {
    requestId: string;
    status: "succeeded" | "failed";
    finalGroupModelId?: string | null;
    externalRequestId?: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [request] = await db
    .update(hubRequests)
    .set({
      status: input.status,
      finalGroupModelId: input.finalGroupModelId ?? null,
      externalRequestId: input.externalRequestId ?? null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(hubRequests.id, input.requestId))
    .returning();
  if (!request) throw new Error("Hub request not found");
  return request;
}

export function normalizeModelName(value: string) {
  return value.trim().toLowerCase();
}

function toHubApiTokenSummary(
  row: typeof hubApiTokens.$inferSelect,
): HubApiTokenSummary {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    prefix: row.prefix,
    status: row.status,
    routingRevision: row.routingRevision,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
