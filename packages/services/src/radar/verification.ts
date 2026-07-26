import { and, count, desc, eq, inArray, ne, sql } from "@openstatus/db";
import {
  radarAccount,
  radarOrder,
  radarVerificationApplication,
  selectRadarVerificationApplicationSchema,
  user,
} from "@openstatus/db/src/schema";

import { emitAudit } from "../audit";
import { requireScope } from "../auth";
import {
  type DB,
  type ServiceContext,
  getReadDb,
  tryGetActorUserId,
  withTransaction,
} from "../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from "../errors";
import { getRadarActorAccess } from "./access";
import { decryptSecret, encryptSecret, hashPrivateIdentifier } from "./crypto";
import { activatePaidRadarOrderForVerification } from "./orders";
import {
  ListRadarVerificationApplicationsInput,
  ReviewRadarVerificationApplicationInput,
  SubmitRadarVerificationApplicationInput,
} from "./schemas";

type VerificationApplicationRow =
  typeof radarVerificationApplication.$inferSelect;

function maskIdentityNumber(value: string) {
  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function maskMobile(value: string) {
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function toPublicApplication(application: VerificationApplicationRow) {
  const {
    identityNumberEncrypted: _identityNumberEncrypted,
    identityNumberHash: _identityNumberHash,
    mobileEncrypted: _mobileEncrypted,
    mobileHash: _mobileHash,
    contactName: _contactName,
    contactQq: _contactQq,
    websiteUrl: _websiteUrl,
    proof: _proof,
    ...safeApplication
  } = selectRadarVerificationApplicationSchema.parse(application);

  return safeApplication;
}

async function toAdminApplication(
  application: VerificationApplicationRow,
  isUpgrade: boolean,
  orderStatus: (typeof radarOrder.$inferSelect)["status"] | null,
) {
  return {
    ...toPublicApplication(application),
    isUpgrade,
    orderStatus,
    identityNumber:
      application.status === "pending" && application.identityNumberEncrypted
        ? await decryptSecret(application.identityNumberEncrypted)
        : null,
    mobile:
      application.status === "pending" && application.mobileEncrypted
        ? await decryptSecret(application.mobileEncrypted)
        : null,
  };
}

async function requireRadarUser(ctx: ServiceContext) {
  const userId = tryGetActorUserId(ctx.actor);
  if (userId == null) {
    throw new ForbiddenError("Radar verification requires a user.");
  }
  return userId;
}

async function getLatestApprovedApplication(db: DB, userId: number) {
  return db
    .select({
      id: radarVerificationApplication.id,
      type: radarVerificationApplication.type,
    })
    .from(radarVerificationApplication)
    .where(
      and(
        eq(radarVerificationApplication.userId, userId),
        eq(radarVerificationApplication.status, "approved"),
      ),
    )
    .orderBy(
      desc(radarVerificationApplication.reviewedAt),
      desc(radarVerificationApplication.id),
    )
    .get();
}

async function hasApprovedPersonalApplication(db: DB, userId: number) {
  const application = await db
    .select({ id: radarVerificationApplication.id })
    .from(radarVerificationApplication)
    .where(
      and(
        eq(radarVerificationApplication.userId, userId),
        eq(radarVerificationApplication.type, "personal"),
        eq(radarVerificationApplication.status, "approved"),
      ),
    )
    .get();

  return application != null;
}

export async function getRadarVerificationOverview(args: {
  ctx: ServiceContext;
  db?: DB;
}) {
  const db = args.db ?? getReadDb(args.ctx);
  const access = await getRadarActorAccess({ ctx: args.ctx, db });
  const [applications, latestApprovedApplication] = await Promise.all([
    db
      .select()
      .from(radarVerificationApplication)
      .where(eq(radarVerificationApplication.userId, access.userId))
      .orderBy(desc(radarVerificationApplication.createdAt))
      .limit(20)
      .all(),
    getLatestApprovedApplication(db, access.userId),
  ]);

  return {
    access,
    activeVerificationType: latestApprovedApplication?.type ?? null,
    applications: applications.map(toPublicApplication),
  };
}

export async function submitRadarVerificationApplication(args: {
  ctx: ServiceContext;
  input: SubmitRadarVerificationApplicationInput;
}) {
  requireScope(args.ctx, "write");
  const input = SubmitRadarVerificationApplicationInput.parse(args.input);
  const userId = await requireRadarUser(args.ctx);
  const identityNumberHash = await hashPrivateIdentifier(input.identityNumber);
  const identityNumberEncrypted = await encryptSecret(input.identityNumber);
  const mobileHash =
    input.type === "personal"
      ? await hashPrivateIdentifier(input.mobile)
      : null;
  const mobileEncrypted =
    input.type === "personal" ? await encryptSecret(input.mobile) : null;

  return withTransaction(args.ctx, async (tx) => {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    const latestApprovedApplication = await getLatestApprovedApplication(
      tx,
      userId,
    );
    const isUpgrade = access.verificationStatus === "verified";
    if (
      isUpgrade &&
      (latestApprovedApplication?.type !== "personal" ||
        input.type !== "enterprise")
    ) {
      throw new ConflictError(
        "Only a personally verified account can upgrade to enterprise verification.",
      );
    }

    const pending = await tx
      .select({ id: radarVerificationApplication.id })
      .from(radarVerificationApplication)
      .where(
        and(
          eq(radarVerificationApplication.userId, userId),
          eq(radarVerificationApplication.status, "pending"),
        ),
      )
      .get();
    if (pending) {
      throw new ConflictError("A verification application is already pending.");
    }

    const duplicateIdentity =
      input.type === "personal"
        ? await tx
            .select({ id: radarVerificationApplication.id })
            .from(radarVerificationApplication)
            .where(
              and(
                eq(radarVerificationApplication.type, "personal"),
                eq(
                  radarVerificationApplication.identityNumberHash,
                  identityNumberHash,
                ),
                ne(radarVerificationApplication.userId, userId),
                inArray(radarVerificationApplication.status, [
                  "pending",
                  "approved",
                ]),
              ),
            )
            .get()
        : null;
    if (duplicateIdentity) {
      throw new ConflictError(
        "This identity is already used by another verified account.",
      );
    }

    const duplicateEnterprise =
      input.type === "enterprise"
        ? await tx
            .select({ id: radarVerificationApplication.id })
            .from(radarVerificationApplication)
            .where(
              and(
                eq(radarVerificationApplication.type, "enterprise"),
                eq(radarVerificationApplication.creditCode, input.creditCode),
                ne(radarVerificationApplication.userId, userId),
                inArray(radarVerificationApplication.status, [
                  "pending",
                  "approved",
                ]),
              ),
            )
            .get()
        : null;
    if (duplicateEnterprise) {
      throw new ConflictError(
        "This enterprise is already used by another verified account.",
      );
    }

    const now = new Date();
    const application = await tx
      .insert(radarVerificationApplication)
      .values({
        userId,
        workspaceId: args.ctx.workspace.id,
        type: input.type,
        status: "pending",
        realName: input.type === "personal" ? input.realName : null,
        companyName: input.type === "enterprise" ? input.companyName : null,
        creditCode: input.type === "enterprise" ? input.creditCode : null,
        legalRepresentativeName:
          input.type === "enterprise" ? input.legalRepresentativeName : null,
        identityNumberEncrypted,
        identityNumberHash,
        identityNumberMasked: maskIdentityNumber(input.identityNumber),
        mobileEncrypted,
        mobileHash,
        mobileMasked:
          input.type === "personal" ? maskMobile(input.mobile) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    if (!isUpgrade) {
      await tx
        .insert(radarAccount)
        .values({ userId, verificationStatus: "pending", updatedAt: now })
        .onConflictDoUpdate({
          target: radarAccount.userId,
          set: { verificationStatus: "pending", updatedAt: now },
        });
    }

    await emitAudit(tx, args.ctx, {
      action: "radar_verification_application.create",
      entityType: "radar_verification_application",
      entityId: application.id,
      after: toPublicApplication(application),
    });

    return toPublicApplication(application);
  });
}

export async function listRadarVerificationApplications(args: {
  ctx: ServiceContext;
  input?: ListRadarVerificationApplicationsInput;
  db?: DB;
}) {
  const db = args.db ?? getReadDb(args.ctx);
  const input = ListRadarVerificationApplicationsInput.parse(args.input);
  const access = await getRadarActorAccess({ ctx: args.ctx, db });
  if (!access.isAdmin) {
    throw new ForbiddenError(
      "Only administrators can review verification applications.",
    );
  }

  const condition = input.status
    ? eq(radarVerificationApplication.status, input.status)
    : sql`1 = 1`;
  const [rows, total] = await Promise.all([
    db
      .select({
        application: radarVerificationApplication,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      })
      .from(radarVerificationApplication)
      .innerJoin(user, eq(user.id, radarVerificationApplication.userId))
      .where(condition)
      .orderBy(desc(radarVerificationApplication.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all(),
    db
      .select({ count: count() })
      .from(radarVerificationApplication)
      .where(condition)
      .get(),
  ]);

  const userIds = Array.from(
    new Set(rows.map((row) => row.application.userId)),
  );
  const approvedPersonalApplications = userIds.length
    ? await db
        .select({ userId: radarVerificationApplication.userId })
        .from(radarVerificationApplication)
        .where(
          and(
            inArray(radarVerificationApplication.userId, userIds),
            eq(radarVerificationApplication.type, "personal"),
            eq(radarVerificationApplication.status, "approved"),
          ),
        )
        .all()
    : [];
  const personallyVerifiedUserIds = new Set(
    approvedPersonalApplications.map((application) => application.userId),
  );
  const applicationIds = rows.map((row) => row.application.id);
  const orderRows = applicationIds.length
    ? await db
        .select({
          applicationId: radarOrder.verificationApplicationId,
          status: radarOrder.status,
        })
        .from(radarOrder)
        .where(inArray(radarOrder.verificationApplicationId, applicationIds))
        .all()
    : [];
  const orderStatusByApplication = new Map(
    orderRows.flatMap((order) =>
      order.applicationId == null
        ? []
        : [[order.applicationId, order.status] as const],
    ),
  );

  const items = await Promise.all(
    rows.map(async (row) => ({
      ...(await toAdminApplication(
        row.application,
        row.application.type === "enterprise" &&
          personallyVerifiedUserIds.has(row.application.userId),
        orderStatusByApplication.get(row.application.id) ?? null,
      )),
      user: row.user,
    })),
  );

  return {
    items,
    totalSize: total?.count ?? 0,
  };
}

export async function reviewRadarVerificationApplication(args: {
  ctx: ServiceContext;
  input: ReviewRadarVerificationApplicationInput;
}) {
  requireScope(args.ctx, "write");
  const input = ReviewRadarVerificationApplicationInput.parse(args.input);
  const reviewerUserId = await requireRadarUser(args.ctx);

  return withTransaction(args.ctx, async (tx) => {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    if (!access.isAdmin) {
      throw new ForbiddenError(
        "Only administrators can review verification applications.",
      );
    }

    const application = await tx
      .select()
      .from(radarVerificationApplication)
      .where(eq(radarVerificationApplication.id, input.applicationId))
      .get();
    if (!application) {
      throw new NotFoundError(
        "radar_verification_application",
        input.applicationId,
      );
    }
    if (application.status !== "pending") {
      throw new PreconditionFailedError(
        "Only pending verification applications can be reviewed.",
      );
    }

    const isUpgrade =
      application.type === "enterprise" &&
      (await hasApprovedPersonalApplication(tx, application.userId));
    const now = new Date();
    if (input.decision === "approved" && !isUpgrade) {
      await activatePaidRadarOrderForVerification({
        ctx: args.ctx,
        tx,
        applicationId: application.id,
        activatedAt: now,
      });
    }
    const updated = await tx
      .update(radarVerificationApplication)
      .set({
        status: input.decision,
        reviewNote: input.reviewNote || null,
        reviewedByUserId: reviewerUserId,
        reviewedAt: now,
        paymentConfirmedAt:
          input.decision === "approved" && !isUpgrade
            ? now
            : application.paymentConfirmedAt,
        identityNumberEncrypted: null,
        mobileEncrypted: null,
        updatedAt: now,
      })
      .where(eq(radarVerificationApplication.id, application.id))
      .returning()
      .get();

    const verificationStatus =
      input.decision === "approved" || isUpgrade ? "verified" : "rejected";
    await tx
      .insert(radarAccount)
      .values({
        userId: application.userId,
        verificationStatus,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: radarAccount.userId,
        set: { verificationStatus, updatedAt: now },
      });

    await emitAudit(tx, args.ctx, {
      action: "radar_verification_application.update",
      entityType: "radar_verification_application",
      entityId: application.id,
      before: toPublicApplication(application),
      after: toPublicApplication(updated),
    });

    return toPublicApplication(updated);
  });
}
