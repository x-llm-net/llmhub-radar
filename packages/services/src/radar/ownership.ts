import { and, eq, inArray, ne } from "@openstatus/db";
import {
  maintenance,
  page,
  pageComponent,
  pageComponentGroup,
  radarAccount,
  radarCredential,
  radarNotificationEvent,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
  radarTargetOpenStatusBinding,
  radarTargetStatus,
  selectRadarPoolSchema,
  statusReport,
} from "@openstatus/db/src/schema";

import { emitAudit } from "../audit";
import { requireScope } from "../auth";
import { type DB, type ServiceContext, withTransaction } from "../context";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  PreconditionFailedError,
} from "../errors";
import { getRadarActorAccess, listRadarOwnerCandidates } from "./access";
import { TransferRadarPoolOwnershipInput } from "./schemas";

const CREDENTIAL_HANDOVER_MS = 24 * 60 * 60 * 1000;

export async function moveRadarPoolOwnership(args: {
  ctx: ServiceContext;
  tx: DB;
  pool: typeof radarPool.$inferSelect;
  ownerUserId: number;
  workspaceId: number;
  claimable: boolean;
  auditAction: "radar_pool.claim" | "radar_pool.update";
}) {
  const { ctx, tx, pool, ownerUserId, workspaceId, claimable } = args;
  if (
    pool.ownerUserId === ownerUserId &&
    pool.workspaceId === workspaceId &&
    pool.claimable === claimable
  ) {
    return selectRadarPoolSchema.parse(pool);
  }

  const conflictingPool = await tx
    .select({ id: radarPool.id })
    .from(radarPool)
    .where(
      and(
        eq(radarPool.workspaceId, workspaceId),
        eq(radarPool.slug, pool.slug),
        ne(radarPool.id, pool.id),
      ),
    )
    .get();
  if (conflictingPool) {
    throw new ConflictError(
      "The target workspace already has a provider with this slug.",
    );
  }

  if (pool.pageId != null) {
    const nonRadarComponent = await tx
      .select({ id: pageComponent.id })
      .from(pageComponent)
      .where(
        and(
          eq(pageComponent.pageId, pool.pageId),
          ne(pageComponent.type, "static"),
        ),
      )
      .get();
    if (nonRadarComponent) {
      throw new PreconditionFailedError(
        "Remove non-Radar status page components before changing ownership.",
      );
    }
  }

  const providers = await tx
    .select({ id: radarProvider.id })
    .from(radarProvider)
    .where(eq(radarProvider.poolId, pool.id))
    .all();
  const providerIds = providers.map((provider) => provider.id);
  const [credentials, targets] = await Promise.all([
    providerIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({
            id: radarCredential.id,
            enabled: radarCredential.enabled,
            encryptedApiKey: radarCredential.encryptedApiKey,
          })
          .from(radarCredential)
          .where(inArray(radarCredential.providerId, providerIds))
          .all(),
    tx
      .select({
        id: radarProbeTarget.id,
        credentialId: radarProbeTarget.credentialId,
      })
      .from(radarProbeTarget)
      .where(eq(radarProbeTarget.poolId, pool.id))
      .all(),
  ]);
  const targetIds = targets.map((target) => target.id);
  const updatedAt = new Date();
  const ownershipChanged =
    pool.ownerUserId !== ownerUserId || pool.workspaceId !== workspaceId;
  const startsPlatformHandover = pool.claimable && !claimable;
  const activeHandoverCredentialIds = startsPlatformHandover
    ? credentials
        .filter(
          (credential) =>
            credential.enabled && credential.encryptedApiKey.length > 0,
        )
        .map((credential) => credential.id)
    : [];
  const activeHandoverCredentialIdSet = new Set(activeHandoverCredentialIds);
  const pausedTargetIds = ownershipChanged
    ? targets
        .filter(
          (target) =>
            !startsPlatformHandover ||
            target.credentialId == null ||
            !activeHandoverCredentialIdSet.has(target.credentialId),
        )
        .map((target) => target.id)
    : [];

  if (providerIds.length > 0) {
    const credentialUpdate: Partial<typeof radarCredential.$inferInsert> = {
      workspaceId,
      updatedAt,
    };
    if (ownershipChanged && startsPlatformHandover) {
      credentialUpdate.handoverExpiresAt = updatedAt;
    } else if (ownershipChanged) {
      credentialUpdate.encryptedApiKey = "";
      credentialUpdate.keyFingerprint = "";
      credentialUpdate.lastFour = "";
      credentialUpdate.enabled = false;
      credentialUpdate.handoverExpiresAt = updatedAt;
    }

    await tx
      .update(radarCredential)
      .set(credentialUpdate)
      .where(inArray(radarCredential.providerId, providerIds));

    if (ownershipChanged && activeHandoverCredentialIds.length > 0) {
      await tx
        .update(radarCredential)
        .set({
          handoverExpiresAt: new Date(
            updatedAt.getTime() + CREDENTIAL_HANDOVER_MS,
          ),
        })
        .where(inArray(radarCredential.id, activeHandoverCredentialIds));
    }
  }

  if (targetIds.length > 0) {
    await tx
      .update(radarTargetStatus)
      .set({ workspaceId })
      .where(inArray(radarTargetStatus.targetId, targetIds));
  }

  if (pausedTargetIds.length > 0) {
    await tx
      .update(radarTargetStatus)
      .set({ currentStatus: "paused", updatedAt })
      .where(inArray(radarTargetStatus.targetId, pausedTargetIds));
  }

  await tx
    .update(radarProvider)
    .set({ workspaceId })
    .where(eq(radarProvider.poolId, pool.id));
  await tx
    .update(radarProbeTarget)
    .set({ workspaceId })
    .where(eq(radarProbeTarget.poolId, pool.id));
  if (pausedTargetIds.length > 0) {
    await tx
      .update(radarProbeTarget)
      .set({
        currentStatus: "paused",
        nextCheckAt: null,
        lockedUntil: null,
        updatedAt,
      })
      .where(inArray(radarProbeTarget.id, pausedTargetIds));
  }
  await tx
    .update(radarProbeRun)
    .set({ workspaceId })
    .where(eq(radarProbeRun.poolId, pool.id));
  await tx
    .update(radarTargetOpenStatusBinding)
    .set({ workspaceId })
    .where(eq(radarTargetOpenStatusBinding.poolId, pool.id));
  await tx
    .update(radarNotificationEvent)
    .set({ workspaceId })
    .where(eq(radarNotificationEvent.poolId, pool.id));

  if (pool.pageId != null) {
    await tx
      .update(page)
      .set({ workspaceId, updatedAt })
      .where(eq(page.id, pool.pageId));
    await tx
      .update(pageComponent)
      .set({ workspaceId })
      .where(eq(pageComponent.pageId, pool.pageId));
    await tx
      .update(pageComponentGroup)
      .set({ workspaceId })
      .where(eq(pageComponentGroup.pageId, pool.pageId));
    await tx
      .update(statusReport)
      .set({ workspaceId })
      .where(eq(statusReport.pageId, pool.pageId));
    await tx
      .update(maintenance)
      .set({ workspaceId })
      .where(eq(maintenance.pageId, pool.pageId));
  }

  const updatedPool = await tx
    .update(radarPool)
    .set({
      workspaceId,
      ownerUserId,
      claimable,
      updatedAt,
    })
    .where(eq(radarPool.id, pool.id))
    .returning()
    .get();

  await emitAudit(tx, ctx, {
    action: args.auditAction,
    entityType: "radar_pool",
    entityId: pool.id,
    before: pool,
    after: updatedPool,
  });

  return selectRadarPoolSchema.parse(updatedPool);
}

export async function transferRadarPoolOwnership(args: {
  ctx: ServiceContext;
  input: TransferRadarPoolOwnershipInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = TransferRadarPoolOwnershipInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const actorAccess = await getRadarActorAccess({ ctx, db: tx });
    if (!actorAccess.isAdmin) {
      throw new ForbiddenError(
        "Only administrators can change provider ownership.",
      );
    }

    const pool = await tx
      .select()
      .from(radarPool)
      .where(eq(radarPool.id, input.poolId))
      .get();
    if (!pool) throw new NotFoundError("radar_pool", input.poolId);

    let ownerUserId = actorAccess.userId;
    let workspaceId = ctx.workspace.id;
    let claimable = true;

    if (input.ownerUserId != null) {
      const candidates = await listRadarOwnerCandidates({
        ctx,
        db: tx,
        input: { query: "", limit: 1, selectedUserId: input.ownerUserId },
      });
      const owner = candidates.find(
        (candidate) => candidate.userId === input.ownerUserId,
      );
      if (!owner) throw new NotFoundError("radar_owner", input.ownerUserId);

      const alreadyOwnedByTarget = pool.ownerUserId === owner.userId;
      if (
        owner.providerLimit != null &&
        owner.providerUsage >= owner.providerLimit &&
        !alreadyOwnedByTarget
      ) {
        throw new LimitExceededError("provider ownership", owner.providerLimit);
      }

      await tx
        .insert(radarAccount)
        .values({ userId: owner.userId })
        .onConflictDoNothing();

      ownerUserId = owner.userId;
      workspaceId = owner.workspaceId;
      claimable = false;
    }

    return moveRadarPoolOwnership({
      ctx,
      tx,
      pool,
      ownerUserId,
      workspaceId,
      claimable,
      auditAction: "radar_pool.update",
    });
  });
}
