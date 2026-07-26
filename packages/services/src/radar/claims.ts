import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "@openstatus/db";
import {
  mediaAsset,
  radarClaimApplication,
  radarClaimApplicationEvidence,
  radarPool,
  selectRadarClaimApplicationSchema,
  user,
} from "@openstatus/db/src/schema";

import { emitAudit } from "../audit";
import { requireScope } from "../auth";
import { type ServiceContext, getReadDb, withTransaction } from "../context";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  PreconditionFailedError,
} from "../errors";
import { getRadarActorAccess, listRadarOwnerCandidates } from "./access";
import { moveRadarPoolOwnership } from "./ownership";
import {
  ListRadarClaimApplicationsInput,
  ReviewRadarClaimApplicationInput,
  SubmitRadarClaimApplicationInput,
} from "./schemas";

function toPublicApplication(
  application: typeof radarClaimApplication.$inferSelect,
) {
  return selectRadarClaimApplicationSchema.parse(application);
}

export async function listRadarClaimApplications(args: {
  ctx: ServiceContext;
  input?: ListRadarClaimApplicationsInput;
}) {
  const db = getReadDb(args.ctx);
  const input = ListRadarClaimApplicationsInput.parse(args.input);
  const access = await getRadarActorAccess({ ctx: args.ctx, db });
  const condition =
    and(
      access.isAdmin
        ? undefined
        : eq(radarClaimApplication.applicantUserId, access.userId),
      access.isAdmin && input.status
        ? eq(radarClaimApplication.status, input.status)
        : undefined,
    ) ?? sql`1 = 1`;

  const [rows, total] = await Promise.all([
    db
      .select({
        application: radarClaimApplication,
        pool: {
          id: radarPool.id,
          name: radarPool.name,
          slug: radarPool.slug,
          claimable: radarPool.claimable,
        },
        applicant: {
          userId: user.id,
          name: user.name,
          email: user.email,
        },
      })
      .from(radarClaimApplication)
      .innerJoin(radarPool, eq(radarPool.id, radarClaimApplication.poolId))
      .innerJoin(user, eq(user.id, radarClaimApplication.applicantUserId))
      .where(condition)
      .orderBy(desc(radarClaimApplication.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all(),
    db
      .select({ count: count() })
      .from(radarClaimApplication)
      .where(condition)
      .get(),
  ]);

  const evidenceRows =
    rows.length === 0
      ? []
      : await db
          .select({
            applicationId: radarClaimApplicationEvidence.applicationId,
            id: mediaAsset.id,
            mimeType: mediaAsset.mimeType,
            sizeBytes: mediaAsset.sizeBytes,
          })
          .from(radarClaimApplicationEvidence)
          .innerJoin(
            mediaAsset,
            eq(mediaAsset.id, radarClaimApplicationEvidence.assetId),
          )
          .where(
            inArray(
              radarClaimApplicationEvidence.applicationId,
              rows.map((row) => row.application.id),
            ),
          )
          .orderBy(
            asc(radarClaimApplicationEvidence.applicationId),
            asc(radarClaimApplicationEvidence.sortOrder),
          )
          .all();
  const evidenceByApplication = new Map<
    number,
    Array<{ id: string; url: string; mimeType: string; sizeBytes: number }>
  >();
  for (const evidence of evidenceRows) {
    const items = evidenceByApplication.get(evidence.applicationId) ?? [];
    items.push({
      id: evidence.id,
      url: `/api/media/${evidence.id}`,
      mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes,
    });
    evidenceByApplication.set(evidence.applicationId, items);
  }

  return {
    items: rows.map((row) => ({
      ...toPublicApplication(row.application),
      pool: row.pool,
      applicant: row.applicant,
      evidenceAssets: evidenceByApplication.get(row.application.id) ?? [],
    })),
    totalSize: total?.count ?? 0,
    access,
  };
}

export async function submitRadarClaimApplication(args: {
  ctx: ServiceContext;
  input: SubmitRadarClaimApplicationInput;
}) {
  requireScope(args.ctx, "write");
  const input = SubmitRadarClaimApplicationInput.parse(args.input);

  return withTransaction(args.ctx, async (tx) => {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    if (access.isAdmin) {
      throw new ForbiddenError(
        "Administrators should assign provider ownership directly.",
      );
    }
    if (access.verificationStatus !== "verified") {
      throw new ForbiddenError(
        "Complete account verification before claiming a provider.",
      );
    }
    if (!access.canCreate && access.providerLimit != null) {
      throw new LimitExceededError("provider ownership", access.providerLimit);
    }

    const pool = await tx
      .select()
      .from(radarPool)
      .where(eq(radarPool.id, input.poolId))
      .get();
    if (!pool) throw new NotFoundError("radar_pool", input.poolId);
    if (!pool.claimable) {
      throw new ConflictError("This provider has already been claimed.");
    }

    const pending = await tx
      .select({ id: radarClaimApplication.id })
      .from(radarClaimApplication)
      .where(
        and(
          eq(radarClaimApplication.poolId, pool.id),
          eq(radarClaimApplication.applicantUserId, access.userId),
          eq(radarClaimApplication.status, "pending"),
        ),
      )
      .get();
    if (pending) {
      throw new ConflictError(
        "A claim application for this provider is already pending.",
      );
    }

    const now = new Date();
    const evidenceAssets =
      input.evidenceAssetIds.length === 0
        ? []
        : await tx
            .select()
            .from(mediaAsset)
            .where(
              and(
                inArray(mediaAsset.id, input.evidenceAssetIds),
                eq(mediaAsset.ownerUserId, access.userId),
                eq(mediaAsset.workspaceId, args.ctx.workspace.id),
                eq(mediaAsset.purpose, "claim_evidence"),
                or(isNull(mediaAsset.expiresAt), gt(mediaAsset.expiresAt, now)),
              ),
            )
            .all();
    if (evidenceAssets.length !== input.evidenceAssetIds.length) {
      throw new ForbiddenError(
        "One or more claim evidence images are unavailable.",
      );
    }

    const application = await tx
      .insert(radarClaimApplication)
      .values({
        poolId: pool.id,
        applicantUserId: access.userId,
        workspaceId: args.ctx.workspace.id,
        status: "pending",
        proof: input.proof,
        evidenceImageUrls: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    if (evidenceAssets.length > 0) {
      await tx.insert(radarClaimApplicationEvidence).values(
        input.evidenceAssetIds.map((assetId, sortOrder) => ({
          applicationId: application.id,
          assetId,
          sortOrder,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await tx
        .update(mediaAsset)
        .set({ expiresAt: null, updatedAt: now })
        .where(inArray(mediaAsset.id, input.evidenceAssetIds));
    }

    await emitAudit(tx, args.ctx, {
      action: "radar_claim_application.create",
      entityType: "radar_claim_application",
      entityId: application.id,
      after: toPublicApplication(application),
    });

    return toPublicApplication(application);
  });
}

export async function reviewRadarClaimApplication(args: {
  ctx: ServiceContext;
  input: ReviewRadarClaimApplicationInput;
}) {
  requireScope(args.ctx, "write");
  const input = ReviewRadarClaimApplicationInput.parse(args.input);

  return withTransaction(args.ctx, async (tx) => {
    const reviewer = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    if (!reviewer.isAdmin) {
      throw new ForbiddenError(
        "Only administrators can review provider claims.",
      );
    }

    const application = await tx
      .select()
      .from(radarClaimApplication)
      .where(eq(radarClaimApplication.id, input.applicationId))
      .get();
    if (!application) {
      throw new NotFoundError("radar_claim_application", input.applicationId);
    }
    if (application.status !== "pending") {
      throw new PreconditionFailedError(
        "Only pending claim applications can be reviewed.",
      );
    }

    const pool = await tx
      .select()
      .from(radarPool)
      .where(eq(radarPool.id, application.poolId))
      .get();
    if (!pool) throw new NotFoundError("radar_pool", application.poolId);

    const now = new Date();
    if (input.decision === "approved") {
      if (!pool.claimable) {
        throw new ConflictError("This provider has already been claimed.");
      }

      const candidates = await listRadarOwnerCandidates({
        ctx: args.ctx,
        db: tx,
        input: {
          query: "",
          limit: 1,
          selectedUserId: application.applicantUserId,
        },
      });
      const owner = candidates.find(
        (candidate) => candidate.userId === application.applicantUserId,
      );
      if (!owner) {
        throw new NotFoundError("radar_owner", application.applicantUserId);
      }
      if (owner.verificationStatus !== "verified") {
        throw new PreconditionFailedError(
          "The applicant must remain verified before approval.",
        );
      }
      if (
        owner.providerLimit != null &&
        owner.providerUsage > owner.providerLimit
      ) {
        throw new LimitExceededError("provider ownership", owner.providerLimit);
      }

      await moveRadarPoolOwnership({
        ctx: args.ctx,
        tx,
        pool,
        ownerUserId: owner.userId,
        workspaceId: owner.workspaceId,
        claimable: false,
        auditAction: "radar_pool.claim",
      });
    }

    const updated = await tx
      .update(radarClaimApplication)
      .set({
        status: input.decision,
        reviewNote: input.reviewNote || null,
        reviewedByUserId: reviewer.userId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(radarClaimApplication.id, application.id))
      .returning()
      .get();

    if (input.decision === "approved") {
      await tx
        .update(radarClaimApplication)
        .set({
          status: "rejected",
          reviewNote: "This provider was assigned to another applicant.",
          reviewedByUserId: reviewer.userId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(radarClaimApplication.poolId, application.poolId),
            eq(radarClaimApplication.status, "pending"),
            ne(radarClaimApplication.id, application.id),
          ),
        );
    }

    await emitAudit(tx, args.ctx, {
      action: "radar_claim_application.update",
      entityType: "radar_claim_application",
      entityId: application.id,
      before: toPublicApplication(application),
      after: toPublicApplication(updated),
    });

    return toPublicApplication(updated);
  });
}
