import { createHash } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import { resolveHubPricing } from "./hub-billing";
import {
  formatModelDisplayName,
  formatModelShortName,
  inferModelMetadata,
  modelSlug,
} from "./model-metadata";
import {
  hubGroupModels,
  hubGroupModelStats,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubHealthBuckets3h,
  hubConfigOutbox,
  hubModelAliases,
  hubModels,
  hubProviderGroups,
  hubProbeTargets,
  hubProviders,
} from "./schema";

type MarketplaceTx = Parameters<Parameters<MarketplaceDb["transaction"]>[0]>[0];

export type HubGroupStateAction = "pause" | "resume" | "retire";

export type HubGroupSummary = {
  id: string;
  providerId: string;
  providerName: string;
  name: string;
  description: string;
  baseUrlCiphertext: string;
  apiKeyLastFour: string;
  lifecycleStatus: "draft" | "verifying" | "ready" | "retired";
  desiredStatus: "active" | "paused" | "retired";
  listingStatus: "private" | "pending" | "listed" | "delisted";
  listingSubmittedAt: Date | null;
  listingReviewedAt: Date | null;
  listingReviewedBy: string | null;
  listingReviewNote: string | null;
  configVersion: number;
  multiplierBps: number | null;
  balanceMicros: bigint | null;
  balanceCurrency: string | null;
  balanceStatus: "unknown" | "available" | "low" | "exhausted" | "error";
  balanceCheckedAt: Date | null;
  models: Array<{
    id: string;
    modelId: string | null;
    upstreamName: string;
    discoveryStatus: "unmapped" | "active" | "missing" | "retired";
    trafficEnabled: boolean;
    probeEnabled: boolean;
    baseUrlOverrideCiphertext: string | null;
    canonicalName: string | null;
    displayName: string | null;
    availabilityBps: number | null;
    firstTokenP50Ms: number | null;
    firstTokenP95Ms: number | null;
    sampleCount: number;
    currentStatus:
      | "unknown"
      | "normal"
      | "degraded"
      | "down"
      | "configuration_error"
      | "stale";
    lastCheckAt: Date | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateHubGroupRecord = {
  ownerWorkspaceId: string;
  providerSlug: string;
  providerName: string;
  name: string;
  description?: string;
  baseUrlCiphertext: string;
  baseUrlHostHash: string;
  apiKeyCiphertext: string;
  keyFingerprint: string;
  apiKeyLastFour: string;
  multiplierBps: number;
  discoveredModels: string[];
};

export type UpdateHubGroupRecord = {
  ownerWorkspaceId: string;
  groupId: string;
  name?: string;
  description?: string;
  baseUrlCiphertext?: string;
  baseUrlHostHash?: string;
  apiKeyCiphertext?: string;
  keyFingerprint?: string;
  apiKeyLastFour?: string;
  multiplierBps?: number;
  discoveredModels?: string[];
};

export class HubGroupNotFoundError extends Error {
  constructor() {
    super("Group not found");
    this.name = "HubGroupNotFoundError";
  }
}

export class HubGroupStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubGroupStateError";
  }
}

export function normalizeHubModelName(value: string) {
  return value.trim().toLowerCase();
}

export async function listHubGroups(
  db: MarketplaceDb,
  ownerWorkspaceId: string,
): Promise<HubGroupSummary[]> {
  const providerRows = await db
    .select({ id: hubProviders.id, name: hubProviders.displayName })
    .from(hubProviders)
    .where(eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId));

  if (providerRows.length === 0) return [];

  const providerNameById = new Map(
    providerRows.map((provider) => [provider.id, provider.name]),
  );
  const providerIds = providerRows.map((provider) => provider.id);
  const groups = await db
    .select({
      id: hubProviderGroups.id,
      providerId: hubProviderGroups.providerId,
      name: hubProviderGroups.name,
      description: hubProviderGroups.description,
      baseUrlCiphertext: hubProviderGroups.baseUrlCiphertext,
      apiKeyLastFour: hubGroupSecrets.lastFour,
      lifecycleStatus: hubProviderGroups.lifecycleStatus,
      desiredStatus: hubProviderGroups.desiredStatus,
      listingStatus: hubProviderGroups.listingStatus,
      listingSubmittedAt: hubProviderGroups.listingSubmittedAt,
      listingReviewedAt: hubProviderGroups.listingReviewedAt,
      listingReviewedBy: hubProviderGroups.listingReviewedBy,
      listingReviewNote: hubProviderGroups.listingReviewNote,
      configVersion: hubProviderGroups.configVersion,
      balanceMicros: hubProviderGroups.lastBalanceMicros,
      balanceCurrency: hubProviderGroups.balanceCurrency,
      balanceStatus: hubProviderGroups.balanceStatus,
      balanceCheckedAt: hubProviderGroups.balanceCheckedAt,
      createdAt: hubProviderGroups.createdAt,
      updatedAt: hubProviderGroups.updatedAt,
    })
    .from(hubProviderGroups)
    .innerJoin(
      hubGroupSecrets,
      eq(hubGroupSecrets.groupId, hubProviderGroups.id),
    )
    .where(inArray(hubProviderGroups.providerId, providerIds))
    .orderBy(desc(hubProviderGroups.createdAt));

  if (groups.length === 0) return [];

  const now = new Date();
  const groupIds = groups.map((group) => group.id);
  const [modelRows, priceRows] = await Promise.all([
    db
      .select({
        id: hubGroupModels.id,
        groupId: hubGroupModels.groupId,
        modelId: hubGroupModels.modelId,
        upstreamName: hubGroupModels.upstreamModelName,
        discoveryStatus: hubGroupModels.discoveryStatus,
        trafficEnabled: hubGroupModels.trafficEnabled,
        probeEnabled: hubGroupModels.probeEnabled,
        baseUrlOverrideCiphertext: hubGroupModels.baseUrlOverrideCiphertext,
        canonicalName: hubModels.canonicalName,
        displayName: hubModels.displayName,
        availabilityBps: hubGroupModelStats.availabilityBps,
        firstTokenP50Ms: hubGroupModelStats.firstTokenP50Ms,
        firstTokenP95Ms: hubGroupModelStats.firstTokenP95Ms,
        sampleCount: hubGroupModelStats.sampleCount,
        currentStatus: hubGroupModelStats.currentStatus,
        lastCheckAt: hubGroupModelStats.lastCheckAt,
      })
      .from(hubGroupModels)
      .leftJoin(hubModels, eq(hubModels.id, hubGroupModels.modelId))
      .leftJoin(
        hubGroupModelStats,
        eq(hubGroupModelStats.groupModelId, hubGroupModels.id),
      )
      .where(inArray(hubGroupModels.groupId, groupIds))
      .orderBy(asc(hubGroupModels.upstreamModelName)),
    db
      .select({
        groupId: hubGroupPriceVersions.groupId,
        multiplierBps: hubGroupPriceVersions.multiplierBps,
      })
      .from(hubGroupPriceVersions)
      .where(
        and(
          inArray(hubGroupPriceVersions.groupId, groupIds),
          lte(hubGroupPriceVersions.effectiveFrom, now),
          or(
            isNull(hubGroupPriceVersions.effectiveTo),
            gt(hubGroupPriceVersions.effectiveTo, now),
          ),
        ),
      ),
  ]);

  const modelsByGroup = new Map<string, HubGroupSummary["models"]>();
  for (const model of modelRows) {
    const current = modelsByGroup.get(model.groupId) ?? [];
    current.push({
      ...model,
      sampleCount: model.sampleCount ?? 0,
      currentStatus: model.currentStatus ?? "unknown",
    });
    modelsByGroup.set(model.groupId, current);
  }
  const multiplierByGroup = new Map(
    priceRows.map((price) => [price.groupId, price.multiplierBps]),
  );

  return groups.map((group) => ({
    ...group,
    providerName: providerNameById.get(group.providerId) ?? "",
    multiplierBps: multiplierByGroup.get(group.id) ?? null,
    models: modelsByGroup.get(group.id) ?? [],
  }));
}

export async function getHubGroup(
  db: MarketplaceDb,
  ownerWorkspaceId: string,
  groupId: string,
) {
  const groups = await listHubGroups(db, ownerWorkspaceId);
  const group = groups.find((item) => item.id === groupId);
  if (!group) throw new HubGroupNotFoundError();
  return group;
}

export async function getHubGroupEncryptedConfig(
  db: MarketplaceDb,
  ownerWorkspaceId: string,
  groupId: string,
) {
  const [group] = await db
    .select({
      id: hubProviderGroups.id,
      baseUrlCiphertext: hubProviderGroups.baseUrlCiphertext,
      apiKeyCiphertext: hubGroupSecrets.apiKeyCiphertext,
      lifecycleStatus: hubProviderGroups.lifecycleStatus,
    })
    .from(hubProviderGroups)
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .innerJoin(
      hubGroupSecrets,
      eq(hubGroupSecrets.groupId, hubProviderGroups.id),
    )
    .where(
      and(
        eq(hubProviderGroups.id, groupId),
        eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId),
      ),
    )
    .limit(1);

  if (!group) throw new HubGroupNotFoundError();
  return group;
}

export async function listHubCatalogRefreshGroups(db: MarketplaceDb) {
  return db
    .select({
      id: hubProviderGroups.id,
      lifecycleStatus: hubProviderGroups.lifecycleStatus,
      desiredStatus: hubProviderGroups.desiredStatus,
      baseUrlCiphertext: hubProviderGroups.baseUrlCiphertext,
      apiKeyCiphertext: hubGroupSecrets.apiKeyCiphertext,
    })
    .from(hubProviderGroups)
    .innerJoin(
      hubGroupSecrets,
      eq(hubGroupSecrets.groupId, hubProviderGroups.id),
    )
    .where(
      and(
        sql`${hubProviderGroups.lifecycleStatus} <> 'retired'`,
        sql`${hubProviderGroups.desiredStatus} <> 'retired'`,
      ),
    )
    .orderBy(asc(hubProviderGroups.createdAt));
}

export async function refreshHubGroupCatalog(
  db: MarketplaceDb,
  input: { groupId: string; discoveredModels: string[] },
) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        id: hubProviderGroups.id,
        lifecycleStatus: hubProviderGroups.lifecycleStatus,
        desiredStatus: hubProviderGroups.desiredStatus,
        listingStatus: hubProviderGroups.listingStatus,
      })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, input.groupId))
      .limit(1)
      .for("update");
    if (!group) throw new HubGroupNotFoundError();
    if (
      group.lifecycleStatus === "retired" ||
      group.desiredStatus === "retired"
    ) {
      return { id: input.groupId, changed: false, skipped: true };
    }

    const now = new Date();
    const changed = await syncDiscoveredModels(
      tx,
      input.groupId,
      input.discoveredModels,
      now,
    );
    if (!changed) {
      return { id: input.groupId, changed: false, skipped: false };
    }

    await tx
      .update(hubProviderGroups)
      .set({
        configVersion: sql`${hubProviderGroups.configVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, input.groupId));
    if (group.listingStatus === "listed") {
      await enqueueHubConfigChange(tx, input.groupId, "upsert");
    }
    return { id: input.groupId, changed: true, skipped: false };
  });
}

export async function listHubCatalogModels(db: MarketplaceDb) {
  return db
    .select({
      id: hubModels.id,
      canonicalName: hubModels.canonicalName,
      displayName: hubModels.displayName,
      vendor: hubModels.vendor,
      family: hubModels.family,
      status: hubModels.status,
    })
    .from(hubModels)
    .where(inArray(hubModels.status, ["active", "deprecated"]))
    .orderBy(asc(hubModels.vendor), asc(hubModels.sortOrder));
}

export async function createHubGroup(
  db: MarketplaceDb,
  input: CreateHubGroupRecord,
) {
  return db.transaction(async (tx) => {
    const provider = await ensureWorkspaceProvider(tx, input);
    const now = new Date();
    const [group] = await tx
      .insert(hubProviderGroups)
      .values({
        providerId: provider.id,
        name: input.name,
        description: input.description ?? "",
        baseUrlCiphertext: input.baseUrlCiphertext,
        baseUrlHostHash: input.baseUrlHostHash,
        lifecycleStatus: "verifying",
        desiredStatus: "active",
        listingStatus: "private",
      })
      .returning({ id: hubProviderGroups.id });

    if (!group) throw new Error("Failed to create group");

    await tx.insert(hubGroupSecrets).values({
      groupId: group.id,
      apiKeyCiphertext: input.apiKeyCiphertext,
      keyFingerprint: input.keyFingerprint,
      lastFour: input.apiKeyLastFour,
    });
    await tx.insert(hubGroupPriceVersions).values({
      groupId: group.id,
      multiplierBps: input.multiplierBps,
      effectiveFrom: now,
      changeReason: "initial group multiplier",
    });
    await syncDiscoveredModels(tx, group.id, input.discoveredModels, now);

    return { id: group.id };
  });
}

export async function updateHubGroup(
  db: MarketplaceDb,
  input: UpdateHubGroupRecord,
) {
  return db.transaction(async (tx) => {
    const group = await requireOwnedGroup(
      tx,
      input.ownerWorkspaceId,
      input.groupId,
    );
    if (group.lifecycleStatus === "retired") {
      throw new HubGroupStateError("Retired groups cannot be edited");
    }

    const now = new Date();
    const connectionChanged =
      input.baseUrlCiphertext !== undefined ||
      input.apiKeyCiphertext !== undefined;

    await tx
      .update(hubProviderGroups)
      .set({
        name: input.name,
        description: input.description,
        baseUrlCiphertext: input.baseUrlCiphertext,
        baseUrlHostHash: input.baseUrlHostHash,
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, input.groupId));

    if (input.apiKeyCiphertext !== undefined) {
      await tx
        .update(hubGroupSecrets)
        .set({
          apiKeyCiphertext: input.apiKeyCiphertext,
          keyFingerprint: input.keyFingerprint,
          lastFour: input.apiKeyLastFour,
          secretVersion: sql`${hubGroupSecrets.secretVersion} + 1`,
          rotatedAt: now,
          updatedAt: now,
        })
        .where(eq(hubGroupSecrets.groupId, input.groupId));
    }

    const multiplierChanged =
      input.multiplierBps === undefined
        ? false
        : await replaceCurrentMultiplier(
            tx,
            input.groupId,
            input.multiplierBps,
            now,
          );

    const catalogChanged =
      input.discoveredModels !== undefined
        ? await syncDiscoveredModels(
            tx,
            input.groupId,
            input.discoveredModels,
            now,
          )
        : false;
    const configChanged = connectionChanged || catalogChanged;

    if (configChanged || multiplierChanged) {
      await tx
        .update(hubProviderGroups)
        .set({
          configVersion: sql`${hubProviderGroups.configVersion} + 1`,
          lifecycleStatus: "verifying",
          updatedAt: now,
        })
        .where(eq(hubProviderGroups.id, input.groupId));
      await tx
        .update(hubGroupModels)
        .set({ trafficEnabled: false, updatedAt: now })
        .where(eq(hubGroupModels.groupId, input.groupId));
    }
    if (
      (configChanged || multiplierChanged) &&
      group.listingStatus === "listed"
    ) {
      await tx
        .update(hubProviderGroups)
        .set({
          listingStatus: "pending",
          listingSubmittedAt: now,
          listingReviewedAt: null,
          listingReviewedBy: null,
          listingReviewNote: null,
          updatedAt: now,
        })
        .where(eq(hubProviderGroups.id, input.groupId));
    }

    if (configChanged) {
      await clearHubGroupDerivedHealth(tx, input.groupId);
    }
    if (
      (configChanged || multiplierChanged) &&
      group.listingStatus === "listed"
    ) {
      await enqueueHubConfigChange(tx, input.groupId, "disable");
    }

    return { id: input.groupId };
  });
}

export async function setHubGroupState(
  db: MarketplaceDb,
  input: {
    ownerWorkspaceId: string;
    groupId: string;
    action: HubGroupStateAction;
  },
) {
  return db.transaction(async (tx) => {
    const group = await requireOwnedGroup(
      tx,
      input.ownerWorkspaceId,
      input.groupId,
    );
    const now = new Date();

    if (input.action === "resume" && group.lifecycleStatus === "retired") {
      throw new HubGroupStateError("Retired groups cannot be resumed");
    }
    if (
      (input.action === "pause" && group.desiredStatus === "paused") ||
      (input.action === "resume" && group.desiredStatus === "active") ||
      (input.action === "retire" && group.lifecycleStatus === "retired")
    ) {
      return { id: input.groupId };
    }

    if (input.action === "retire") {
      await tx
        .update(hubProviderGroups)
        .set({
          lifecycleStatus: "retired",
          desiredStatus: "retired",
          listingStatus: "delisted",
          configVersion: sql`${hubProviderGroups.configVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(hubProviderGroups.id, input.groupId));
      await tx
        .update(hubGroupModels)
        .set({
          discoveryStatus: "retired",
          trafficEnabled: false,
          probeEnabled: false,
          retiredAt: now,
          updatedAt: now,
        })
        .where(eq(hubGroupModels.groupId, input.groupId));
    } else {
      await tx
        .update(hubProviderGroups)
        .set({
          desiredStatus: input.action === "pause" ? "paused" : "active",
          configVersion: sql`${hubProviderGroups.configVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(hubProviderGroups.id, input.groupId));
    }
    if (group.listingStatus === "listed" || input.action === "retire") {
      await enqueueHubConfigChange(
        tx,
        input.groupId,
        input.action === "resume" ? "upsert" : "disable",
      );
    }

    return { id: input.groupId };
  });
}

export async function mapHubGroupModel(
  db: MarketplaceDb,
  input: {
    ownerWorkspaceId: string;
    groupModelId: string;
    modelId: string | null;
    trafficEnabled?: boolean;
    probeEnabled?: boolean;
  },
) {
  return db.transaction(async (tx) => {
    const [groupModel] = await tx
      .select({
        id: hubGroupModels.id,
        groupId: hubGroupModels.groupId,
        listingStatus: hubProviderGroups.listingStatus,
      })
      .from(hubGroupModels)
      .innerJoin(
        hubProviderGroups,
        eq(hubProviderGroups.id, hubGroupModels.groupId),
      )
      .innerJoin(
        hubProviders,
        eq(hubProviders.id, hubProviderGroups.providerId),
      )
      .where(
        and(
          eq(hubGroupModels.id, input.groupModelId),
          eq(hubProviders.ownerWorkspaceId, input.ownerWorkspaceId),
        ),
      )
      .limit(1)
      .for("update", { of: hubProviderGroups });

    if (!groupModel) throw new HubGroupNotFoundError();

    if (input.modelId) {
      const [model] = await tx
        .select({ status: hubModels.status })
        .from(hubModels)
        .where(eq(hubModels.id, input.modelId))
        .limit(1);
      if (!model || model.status === "retired") {
        throw new HubGroupStateError("The selected model is unavailable");
      }

      const [conflict] = await tx
        .select({ id: hubGroupModels.id })
        .from(hubGroupModels)
        .where(
          and(
            eq(hubGroupModels.groupId, groupModel.groupId),
            eq(hubGroupModels.modelId, input.modelId),
            inArray(hubGroupModels.discoveryStatus, ["active", "missing"]),
          ),
        )
        .limit(1);
      if (conflict && conflict.id !== input.groupModelId) {
        throw new HubGroupStateError(
          "This group already maps another upstream name to the selected model",
        );
      }
    }

    await tx
      .update(hubGroupModels)
      .set({
        modelId: input.modelId,
        discoveryStatus: input.modelId ? "active" : "unmapped",
        trafficEnabled: input.modelId ? (input.trafficEnabled ?? false) : false,
        probeEnabled: input.modelId ? (input.probeEnabled ?? true) : false,
        missingCount: 0,
        retiredAt: null,
        updatedAt: new Date(),
      })
      .where(eq(hubGroupModels.id, input.groupModelId));
    const now = new Date();
    await tx
      .update(hubProviderGroups)
      .set({
        configVersion: sql`${hubProviderGroups.configVersion} + 1`,
        lifecycleStatus: "verifying",
        ...(groupModel.listingStatus === "listed"
          ? {
              listingStatus: "pending" as const,
              listingSubmittedAt: now,
              listingReviewedAt: null,
              listingReviewedBy: null,
              listingReviewNote: null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, groupModel.groupId));
    if (groupModel.listingStatus === "listed") {
      await tx
        .update(hubGroupModels)
        .set({ trafficEnabled: false, updatedAt: now })
        .where(eq(hubGroupModels.groupId, groupModel.groupId));
    }
    await clearHubGroupDerivedHealth(tx, groupModel.groupId);
    await syncHubProbeTargets(tx, groupModel.groupId, now);
    if (groupModel.listingStatus === "listed") {
      await enqueueHubConfigChange(tx, groupModel.groupId, "disable");
    }

    return { id: input.groupModelId };
  });
}

export async function setHubGroupModelBaseUrlOverride(
  db: MarketplaceDb,
  input: {
    ownerWorkspaceId: string;
    groupModelId: string;
    baseUrlOverrideCiphertext: string | null;
    baseUrlOverrideHostHash: string | null;
  },
) {
  if (
    (input.baseUrlOverrideCiphertext === null) !==
    (input.baseUrlOverrideHostHash === null)
  ) {
    throw new HubGroupStateError(
      "The Base URL override and its host hash must be updated together",
    );
  }

  return db.transaction(async (tx) => {
    const [groupModel] = await tx
      .select({
        id: hubGroupModels.id,
        groupId: hubGroupModels.groupId,
        currentHostHash: hubGroupModels.baseUrlOverrideHostHash,
        lifecycleStatus: hubProviderGroups.lifecycleStatus,
        listingStatus: hubProviderGroups.listingStatus,
      })
      .from(hubGroupModels)
      .innerJoin(
        hubProviderGroups,
        eq(hubProviderGroups.id, hubGroupModels.groupId),
      )
      .innerJoin(
        hubProviders,
        eq(hubProviders.id, hubProviderGroups.providerId),
      )
      .where(
        and(
          eq(hubGroupModels.id, input.groupModelId),
          eq(hubProviders.ownerWorkspaceId, input.ownerWorkspaceId),
        ),
      )
      .limit(1)
      .for("update", { of: hubProviderGroups });

    if (!groupModel) throw new HubGroupNotFoundError();
    if (groupModel.lifecycleStatus === "retired") {
      throw new HubGroupStateError("Retired groups cannot be edited");
    }
    if (groupModel.currentHostHash === input.baseUrlOverrideHostHash) {
      return { id: input.groupModelId, changed: false };
    }

    const now = new Date();
    await tx
      .update(hubGroupModels)
      .set({
        baseUrlOverrideCiphertext: input.baseUrlOverrideCiphertext,
        baseUrlOverrideHostHash: input.baseUrlOverrideHostHash,
        updatedAt: now,
      })
      .where(eq(hubGroupModels.id, input.groupModelId));
    await tx
      .update(hubProviderGroups)
      .set({
        configVersion: sql`${hubProviderGroups.configVersion} + 1`,
        lifecycleStatus: "verifying",
        ...(groupModel.listingStatus === "listed"
          ? {
              listingStatus: "pending" as const,
              listingSubmittedAt: now,
              listingReviewedAt: null,
              listingReviewedBy: null,
              listingReviewNote: null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, groupModel.groupId));
    if (groupModel.listingStatus === "listed") {
      await tx
        .update(hubGroupModels)
        .set({ trafficEnabled: false, updatedAt: now })
        .where(eq(hubGroupModels.groupId, groupModel.groupId));
    }
    await clearHubGroupDerivedHealth(tx, groupModel.groupId);
    await syncHubProbeTargets(tx, groupModel.groupId, now);
    if (groupModel.listingStatus === "listed") {
      await enqueueHubConfigChange(tx, groupModel.groupId, "disable");
    }
    return { id: input.groupModelId, changed: true };
  });
}

export async function requestHubGroupListing(
  db: MarketplaceDb,
  input: { ownerWorkspaceId: string; groupId: string },
) {
  return db.transaction(async (tx) => {
    const group = await requireOwnedGroup(
      tx,
      input.ownerWorkspaceId,
      input.groupId,
    );
    if (group.lifecycleStatus !== "ready") {
      throw new HubGroupStateError(
        "The group must complete a successful probe before listing",
      );
    }
    if (group.listingStatus === "pending") return { id: input.groupId };
    if (group.listingStatus === "listed") {
      throw new HubGroupStateError("The group is already listed");
    }
    if (group.desiredStatus !== "active") {
      throw new HubGroupStateError("The group must be active before listing");
    }
    const [model] = await tx
      .select({ id: hubGroupModels.id })
      .from(hubGroupModels)
      .where(
        and(
          eq(hubGroupModels.groupId, input.groupId),
          eq(hubGroupModels.discoveryStatus, "active"),
          eq(hubGroupModels.probeEnabled, true),
        ),
      )
      .limit(1);
    if (!model) {
      throw new HubGroupStateError("The group has no active models");
    }
    const now = new Date();
    await tx
      .update(hubProviderGroups)
      .set({
        listingStatus: "pending",
        listingSubmittedAt: now,
        listingReviewedAt: null,
        listingReviewedBy: null,
        listingReviewNote: null,
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, input.groupId));
    return { id: input.groupId };
  });
}

export async function withdrawHubGroupListing(
  db: MarketplaceDb,
  input: { ownerWorkspaceId: string; groupId: string },
) {
  return db.transaction(async (tx) => {
    const group = await requireOwnedGroup(
      tx,
      input.ownerWorkspaceId,
      input.groupId,
    );
    if (
      group.listingStatus === "private" ||
      group.listingStatus === "delisted"
    ) {
      return { id: input.groupId };
    }
    const now = new Date();
    const wasListed = group.listingStatus === "listed";
    await tx
      .update(hubProviderGroups)
      .set({
        listingStatus: wasListed ? "delisted" : "private",
        ...(wasListed
          ? { configVersion: sql`${hubProviderGroups.configVersion} + 1` }
          : {}),
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, input.groupId));
    if (wasListed) {
      await tx
        .update(hubGroupModels)
        .set({ trafficEnabled: false, updatedAt: now })
        .where(eq(hubGroupModels.groupId, input.groupId));
      await enqueueHubConfigChange(tx, input.groupId, "disable");
    }
    return { id: input.groupId };
  });
}

export async function listHubListingReviews(
  db: MarketplaceDb,
  status?: "pending" | "listed" | "delisted" | "private",
) {
  const rows = await db
    .select({
      id: hubProviderGroups.id,
      providerName: hubProviders.displayName,
      ownerWorkspaceId: hubProviders.ownerWorkspaceId,
      name: hubProviderGroups.name,
      description: hubProviderGroups.description,
      lifecycleStatus: hubProviderGroups.lifecycleStatus,
      desiredStatus: hubProviderGroups.desiredStatus,
      listingStatus: hubProviderGroups.listingStatus,
      listingSubmittedAt: hubProviderGroups.listingSubmittedAt,
      listingReviewedAt: hubProviderGroups.listingReviewedAt,
      listingReviewedBy: hubProviderGroups.listingReviewedBy,
      listingReviewNote: hubProviderGroups.listingReviewNote,
      balanceStatus: hubProviderGroups.balanceStatus,
      createdAt: hubProviderGroups.createdAt,
    })
    .from(hubProviderGroups)
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(status ? eq(hubProviderGroups.listingStatus, status) : undefined)
    .orderBy(
      desc(hubProviderGroups.listingSubmittedAt),
      desc(hubProviderGroups.createdAt),
    );
  const groupIds = rows.map((row) => row.id);
  const models =
    groupIds.length === 0
      ? []
      : await db
          .select({
            groupId: hubGroupModels.groupId,
            modelId: hubGroupModels.modelId,
            displayName: hubModels.displayName,
            currentStatus: hubGroupModelStats.currentStatus,
            sampleCount: hubGroupModelStats.sampleCount,
          })
          .from(hubGroupModels)
          .leftJoin(hubModels, eq(hubModels.id, hubGroupModels.modelId))
          .leftJoin(
            hubGroupModelStats,
            eq(hubGroupModelStats.groupModelId, hubGroupModels.id),
          )
          .where(
            and(
              inArray(hubGroupModels.groupId, groupIds),
              eq(hubGroupModels.discoveryStatus, "active"),
            ),
          );
  const modelsWithPricing = await Promise.all(
    models.map(async (model) => ({
      ...model,
      priceReady:
        model.modelId !== null &&
        (await resolveHubPricing(db, {
          modelId: model.modelId,
          groupId: model.groupId,
        })) !== null,
    })),
  );
  return rows.map((row) => ({
    ...row,
    models: modelsWithPricing
      .filter((model) => model.groupId === row.id)
      .map(({ groupId: _groupId, modelId: _modelId, ...model }) => ({
        ...model,
        sampleCount: model.sampleCount ?? 0,
        currentStatus: model.currentStatus ?? "unknown",
      })),
  }));
}

export async function reviewHubGroupListing(
  db: MarketplaceDb,
  input: {
    groupId: string;
    decision: "approve" | "reject";
    reviewer: string;
    note?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        id: hubProviderGroups.id,
        listingStatus: hubProviderGroups.listingStatus,
        lifecycleStatus: hubProviderGroups.lifecycleStatus,
      })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, input.groupId))
      .limit(1)
      .for("update");
    if (!group) throw new HubGroupNotFoundError();
    if (group.listingStatus !== "pending") {
      throw new HubGroupStateError("Only pending groups can be reviewed");
    }
    if (input.decision === "approve" && group.lifecycleStatus !== "ready") {
      throw new HubGroupStateError("Only ready groups can be listed");
    }
    if (input.decision === "reject" && !input.note?.trim()) {
      throw new HubGroupStateError("A rejection note is required");
    }
    const activeModels = await tx
      .select({ id: hubGroupModels.id, modelId: hubGroupModels.modelId })
      .from(hubGroupModels)
      .where(
        and(
          eq(hubGroupModels.groupId, input.groupId),
          eq(hubGroupModels.discoveryStatus, "active"),
          eq(hubGroupModels.probeEnabled, true),
        ),
      );
    if (input.decision === "approve" && activeModels.length === 0) {
      throw new HubGroupStateError("The group has no active models");
    }
    if (input.decision === "approve") {
      for (const model of activeModels) {
        const pricing = model.modelId
          ? await resolveHubPricing(tx, {
              modelId: model.modelId,
              groupId: input.groupId,
            })
          : null;
        if (!pricing) {
          throw new HubGroupStateError(
            "Every active model requires input and output prices",
          );
        }
      }
    }
    const now = new Date();
    const approved = input.decision === "approve";
    await tx
      .update(hubProviderGroups)
      .set({
        listingStatus: approved ? "listed" : "private",
        configVersion: sql`${hubProviderGroups.configVersion} + 1`,
        listingReviewedAt: now,
        listingReviewedBy: input.reviewer,
        listingReviewNote: input.note?.trim() || null,
        updatedAt: now,
      })
      .where(eq(hubProviderGroups.id, input.groupId));
    if (approved) {
      await tx
        .update(hubGroupModels)
        .set({ trafficEnabled: true, updatedAt: now })
        .where(
          and(
            eq(hubGroupModels.groupId, input.groupId),
            eq(hubGroupModels.discoveryStatus, "active"),
          ),
        );
    } else {
      await tx
        .update(hubGroupModels)
        .set({ trafficEnabled: false, updatedAt: now })
        .where(eq(hubGroupModels.groupId, input.groupId));
    }
    await enqueueHubConfigChange(
      tx,
      input.groupId,
      approved ? "upsert" : "disable",
    );
    return { id: input.groupId };
  });
}

async function clearHubGroupDerivedHealth(tx: MarketplaceTx, groupId: string) {
  const models = await tx
    .select({ id: hubGroupModels.id })
    .from(hubGroupModels)
    .where(eq(hubGroupModels.groupId, groupId));
  const ids = models.map((model) => model.id);
  if (ids.length === 0) return;
  await tx
    .delete(hubGroupModelStats)
    .where(inArray(hubGroupModelStats.groupModelId, ids));
  await tx
    .delete(hubHealthBuckets3h)
    .where(inArray(hubHealthBuckets3h.groupModelId, ids));
}

async function ensureWorkspaceProvider(
  tx: MarketplaceTx,
  input: Pick<
    CreateHubGroupRecord,
    "ownerWorkspaceId" | "providerSlug" | "providerName"
  >,
) {
  const [owned] = await tx
    .select({ id: hubProviders.id })
    .from(hubProviders)
    .where(
      and(
        eq(hubProviders.ownerWorkspaceId, input.ownerWorkspaceId),
        eq(hubProviders.slug, input.providerSlug),
      ),
    )
    .limit(1);
  if (owned) return owned;

  const [created] = await tx
    .insert(hubProviders)
    .values({
      ownerWorkspaceId: input.ownerWorkspaceId,
      managementMode: "provider_managed",
      slug: input.providerSlug,
      name: input.providerName,
      displayName: input.providerName,
      status: "active",
    })
    .onConflictDoNothing({ target: hubProviders.slug })
    .returning({ id: hubProviders.id });
  if (created) return created;

  const [existing] = await tx
    .select({
      id: hubProviders.id,
      ownerWorkspaceId: hubProviders.ownerWorkspaceId,
    })
    .from(hubProviders)
    .where(eq(hubProviders.slug, input.providerSlug))
    .limit(1);
  if (!existing || existing.ownerWorkspaceId !== input.ownerWorkspaceId) {
    throw new HubGroupStateError("Provider slug is already in use");
  }
  return existing;
}

async function requireOwnedGroup(
  tx: MarketplaceTx,
  ownerWorkspaceId: string,
  groupId: string,
) {
  const [group] = await tx
    .select({
      id: hubProviderGroups.id,
      lifecycleStatus: hubProviderGroups.lifecycleStatus,
      listingStatus: hubProviderGroups.listingStatus,
      desiredStatus: hubProviderGroups.desiredStatus,
    })
    .from(hubProviderGroups)
    .innerJoin(hubProviders, eq(hubProviders.id, hubProviderGroups.providerId))
    .where(
      and(
        eq(hubProviderGroups.id, groupId),
        eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId),
      ),
    )
    .limit(1)
    .for("update", { of: hubProviderGroups });
  if (!group) throw new HubGroupNotFoundError();
  return group;
}

async function enqueueHubConfigChange(
  tx: MarketplaceTx,
  groupId: string,
  action: "upsert" | "disable",
) {
  const [group] = await tx
    .select({ configVersion: hubProviderGroups.configVersion })
    .from(hubProviderGroups)
    .where(eq(hubProviderGroups.id, groupId))
    .limit(1);
  if (!group) throw new HubGroupNotFoundError();
  await tx
    .insert(hubConfigOutbox)
    .values({ groupId, configVersion: group.configVersion, action })
    .onConflictDoNothing({
      target: [
        hubConfigOutbox.groupId,
        hubConfigOutbox.configVersion,
        hubConfigOutbox.action,
      ],
    });
}

async function buildModelMap(tx: MarketplaceTx) {
  const [modelRows, aliasRows] = await Promise.all([
    tx
      .select({
        id: hubModels.id,
        canonicalName: hubModels.canonicalName,
        status: hubModels.status,
      })
      .from(hubModels),
    tx
      .select({
        modelId: hubModelAliases.modelId,
        normalizedAlias: hubModelAliases.normalizedAlias,
      })
      .from(hubModelAliases),
  ]);
  const byId = new Map(modelRows.map((model) => [model.id, model]));
  const result = new Map<
    string,
    { id: string; status: "active" | "deprecated" | "retired" }
  >();
  for (const model of modelRows) {
    result.set(normalizeHubModelName(model.canonicalName), {
      id: model.id,
      status: model.status,
    });
  }
  for (const alias of aliasRows) {
    const model = byId.get(alias.modelId);
    if (model) {
      result.set(normalizeHubModelName(alias.normalizedAlias), {
        id: model.id,
        status: model.status,
      });
    }
  }
  return result;
}

async function syncDiscoveredModels(
  tx: MarketplaceTx,
  groupId: string,
  discoveredModels: string[],
  now: Date,
) {
  let changed = false;
  const normalized = new Map<string, string>();
  for (const model of discoveredModels) {
    const name = model.trim();
    if (name) normalized.set(normalizeHubModelName(name), name);
  }

  const existingRows = await tx
    .select()
    .from(hubGroupModels)
    .where(eq(hubGroupModels.groupId, groupId));
  const existingByName = new Map(
    existingRows.map((model) => [model.normalizedUpstreamName, model]),
  );
  const modelMap = await buildModelMap(tx);

  for (const [normalizedName, upstreamName] of normalized) {
    const existing = existingByName.get(normalizedName);
    let mapped = modelMap.get(normalizedName);
    if (!mapped && !existing?.modelId) {
      const metadata = inferModelMetadata(upstreamName);
      const baseSlug = modelSlug(upstreamName);
      const [slugOwner] = await tx
        .select({ canonicalName: hubModels.canonicalName })
        .from(hubModels)
        .where(eq(hubModels.slug, baseSlug))
        .limit(1);
      const slug =
        slugOwner &&
        normalizeHubModelName(slugOwner.canonicalName) !== normalizedName
          ? `${baseSlug}-${createHash("sha256")
              .update(normalizedName)
              .digest("hex")
              .slice(0, 8)}`
          : baseSlug;
      const [created] = await tx
        .insert(hubModels)
        .values({
          slug,
          vendor: metadata.vendor,
          family: metadata.family,
          canonicalName: upstreamName,
          displayName: formatModelDisplayName(upstreamName),
          shortName: formatModelShortName(upstreamName),
          capabilities: ["chat_completions"],
        })
        .onConflictDoNothing({ target: hubModels.canonicalName })
        .returning({ id: hubModels.id, status: hubModels.status });
      if (created) {
        mapped = created;
      } else {
        const [catalogModel] = await tx
          .select({ id: hubModels.id, status: hubModels.status })
          .from(hubModels)
          .where(eq(hubModels.canonicalName, upstreamName))
          .limit(1);
        mapped = catalogModel;
      }
      if (mapped) modelMap.set(normalizedName, mapped);
    }
    const mappedModelId = existing?.modelId ?? mapped?.id ?? null;
    const mappedModel = mappedModelId
      ? Array.from(modelMap.values()).find(
          (model) => model.id === mappedModelId,
        )
      : undefined;
    const canUse = Boolean(mappedModelId && mappedModel?.status !== "retired");

    if (existing) {
      const nextStatus = canUse ? "active" : "unmapped";
      changed ||=
        existing.upstreamModelName !== upstreamName ||
        existing.modelId !== mappedModelId ||
        existing.discoveryStatus !== nextStatus ||
        existing.missingCount !== 0 ||
        existing.retiredAt !== null;
      await tx
        .update(hubGroupModels)
        .set({
          upstreamModelName: upstreamName,
          modelId: mappedModelId,
          discoveryStatus: canUse ? "active" : "unmapped",
          trafficEnabled: canUse ? existing.trafficEnabled : false,
          probeEnabled: canUse ? existing.probeEnabled : false,
          missingCount: 0,
          retiredAt: null,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(hubGroupModels.id, existing.id));
    } else {
      changed = true;
      await tx.insert(hubGroupModels).values({
        groupId,
        modelId: mappedModelId,
        upstreamModelName: upstreamName,
        normalizedUpstreamName: normalizedName,
        discoveryStatus: canUse ? "active" : "unmapped",
        probeEnabled: canUse,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }

  for (const existing of existingRows) {
    if (normalized.has(existing.normalizedUpstreamName)) continue;
    changed = true;
    const missingCount = existing.missingCount + 1;
    const retired = missingCount >= 3;
    await tx
      .update(hubGroupModels)
      .set({
        missingCount,
        discoveryStatus: retired ? "retired" : "missing",
        trafficEnabled: false,
        probeEnabled: existing.probeEnabled,
        retiredAt: retired ? now : null,
        updatedAt: now,
      })
      .where(eq(hubGroupModels.id, existing.id));
  }

  await syncHubProbeTargets(tx, groupId, now);
  return changed;
}

async function syncHubProbeTargets(
  tx: MarketplaceTx,
  groupId: string,
  now: Date,
) {
  const models = await tx
    .select({
      id: hubGroupModels.id,
      probeEnabled: hubGroupModels.probeEnabled,
      discoveryStatus: hubGroupModels.discoveryStatus,
    })
    .from(hubGroupModels)
    .where(eq(hubGroupModels.groupId, groupId));

  for (const model of models) {
    const enabled = model.probeEnabled && model.discoveryStatus === "active";
    await tx
      .insert(hubProbeTargets)
      .values({
        groupModelId: model.id,
        enabled,
        nextCheckAt: now,
      })
      .onConflictDoUpdate({
        target: hubProbeTargets.groupModelId,
        set: { enabled, updatedAt: now },
      });
  }
}

async function replaceCurrentMultiplier(
  tx: MarketplaceTx,
  groupId: string,
  multiplierBps: number,
  now: Date,
) {
  const [current] = await tx
    .select({
      id: hubGroupPriceVersions.id,
      multiplierBps: hubGroupPriceVersions.multiplierBps,
      effectiveFrom: hubGroupPriceVersions.effectiveFrom,
    })
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
    .orderBy(desc(hubGroupPriceVersions.effectiveFrom))
    .limit(1);

  if (current?.multiplierBps === multiplierBps) return false;
  if (current && current.effectiveFrom.getTime() >= now.getTime()) {
    await tx
      .update(hubGroupPriceVersions)
      .set({ multiplierBps, updatedAt: now })
      .where(eq(hubGroupPriceVersions.id, current.id));
    return true;
  }
  if (current) {
    await tx
      .update(hubGroupPriceVersions)
      .set({ effectiveTo: now, updatedAt: now })
      .where(eq(hubGroupPriceVersions.id, current.id));
  }
  await tx.insert(hubGroupPriceVersions).values({
    groupId,
    multiplierBps,
    effectiveFrom: now,
    changeReason: "group multiplier updated",
  });
  return true;
}
