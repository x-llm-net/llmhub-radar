import { randomUUID } from "node:crypto";

import { and, count, desc, eq, gt, inArray } from "@openstatus/db";
import {
  mediaAsset,
  radarOrder,
  radarVerificationApplication,
  selectRadarOrderSchema,
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
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from "../errors";
import { getRadarActorAccess } from "./access";
import {
  ListRadarOrdersInput,
  ReviewRadarOrderInput,
  SubmitRadarOrderReceiptInput,
} from "./schemas";

export const PERMANENT_LISTING_PRICE_CENTS = 9_900;

function orderNumber(now: Date) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `LLM-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function requireUserId(ctx: ServiceContext) {
  const userId = tryGetActorUserId(ctx.actor);
  if (userId == null)
    throw new ForbiddenError("Orders require a signed-in user.");
  return userId;
}

function publicOrder(order: typeof radarOrder.$inferSelect) {
  return {
    ...selectRadarOrderSchema.parse(order),
    receiptUrl: order.receiptAssetId
      ? `/api/media/${order.receiptAssetId}`
      : null,
  };
}

export async function listRadarOrders(args: {
  ctx: ServiceContext;
  input?: ListRadarOrdersInput;
  db?: DB;
}) {
  const db = args.db ?? getReadDb(args.ctx);
  const input = ListRadarOrdersInput.parse(args.input ?? {});
  const access = await getRadarActorAccess({ ctx: args.ctx, db });
  const filters = [
    access.isAdmin ? undefined : eq(radarOrder.userId, access.userId),
    input.status ? eq(radarOrder.status, input.status) : undefined,
  ];
  const where = and(...filters);

  const [rows, total] = await Promise.all([
    db
      .select({
        order: radarOrder,
        user: { id: user.id, email: user.email, name: user.name },
        application: {
          id: radarVerificationApplication.id,
          type: radarVerificationApplication.type,
          status: radarVerificationApplication.status,
        },
      })
      .from(radarOrder)
      .innerJoin(user, eq(user.id, radarOrder.userId))
      .leftJoin(
        radarVerificationApplication,
        eq(
          radarVerificationApplication.id,
          radarOrder.verificationApplicationId,
        ),
      )
      .where(where)
      .orderBy(desc(radarOrder.createdAt), desc(radarOrder.id))
      .limit(input.limit)
      .offset(input.offset)
      .all(),
    db.select({ count: count() }).from(radarOrder).where(where).get(),
  ]);

  return {
    access,
    items: rows.map((row) => ({
      ...publicOrder(row.order),
      user: row.user,
      application:
        row.application == null || row.application.id == null
          ? null
          : row.application,
    })),
    totalSize: total?.count ?? 0,
  };
}

export async function createPermanentListingOrder(args: {
  ctx: ServiceContext;
}) {
  requireScope(args.ctx, "write");
  const userId = requireUserId(args.ctx);

  return withTransaction(args.ctx, async (tx) => {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    if (access.verificationStatus === "verified") {
      throw new PreconditionFailedError(
        "Permanent listing benefits are already active.",
      );
    }

    const application = await tx
      .select()
      .from(radarVerificationApplication)
      .where(
        and(
          eq(radarVerificationApplication.userId, userId),
          eq(radarVerificationApplication.status, "pending"),
        ),
      )
      .orderBy(desc(radarVerificationApplication.createdAt))
      .get();
    if (!application) {
      throw new PreconditionFailedError(
        "Submit a verification application before creating an order.",
      );
    }

    const existing = await tx
      .select()
      .from(radarOrder)
      .where(
        and(
          eq(radarOrder.userId, userId),
          eq(radarOrder.type, "permanent_listing"),
          inArray(radarOrder.status, [
            "pending_payment",
            "pending_review",
            "paid",
            "rejected",
          ]),
        ),
      )
      .orderBy(desc(radarOrder.createdAt))
      .get();
    if (existing) {
      if (existing.verificationApplicationId === application.id) {
        return publicOrder(existing);
      }
      const updated = await tx
        .update(radarOrder)
        .set({
          verificationApplicationId: application.id,
          updatedAt: new Date(),
        })
        .where(eq(radarOrder.id, existing.id))
        .returning()
        .get();
      await emitAudit(tx, args.ctx, {
        action: "radar_order.update",
        entityType: "radar_order",
        entityId: existing.id,
        before: publicOrder(existing),
        after: publicOrder(updated),
      });
      return publicOrder(updated);
    }

    const now = new Date();
    const created = await tx
      .insert(radarOrder)
      .values({
        orderNumber: orderNumber(now),
        userId,
        workspaceId: args.ctx.workspace.id,
        verificationApplicationId: application.id,
        type: "permanent_listing",
        status: "pending_payment",
        amountCents: PERMANENT_LISTING_PRICE_CENTS,
        currency: "CNY",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await emitAudit(tx, args.ctx, {
      action: "radar_order.create",
      entityType: "radar_order",
      entityId: created.id,
      after: publicOrder(created),
    });
    return publicOrder(created);
  });
}

export async function submitRadarOrderReceipt(args: {
  ctx: ServiceContext;
  input: SubmitRadarOrderReceiptInput;
}) {
  requireScope(args.ctx, "write");
  const input = SubmitRadarOrderReceiptInput.parse(args.input);
  const userId = requireUserId(args.ctx);

  return withTransaction(args.ctx, async (tx) => {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    const order = await tx
      .select()
      .from(radarOrder)
      .where(eq(radarOrder.id, input.orderId))
      .get();
    if (!order) throw new NotFoundError("radar_order", input.orderId);
    if (!access.isAdmin && order.userId !== userId) {
      throw new ForbiddenError("You cannot update this order.");
    }
    if (order.status !== "pending_payment" && order.status !== "rejected") {
      throw new PreconditionFailedError(
        "Only unpaid or rejected orders can submit a receipt.",
      );
    }

    const now = new Date();
    const asset = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(
          eq(mediaAsset.id, input.receiptAssetId),
          eq(mediaAsset.ownerUserId, order.userId),
          eq(mediaAsset.workspaceId, order.workspaceId),
          eq(mediaAsset.purpose, "order_receipt"),
          gt(mediaAsset.expiresAt, now),
        ),
      )
      .get();
    if (!asset) {
      throw new PreconditionFailedError(
        "The payment receipt is missing, expired, or belongs to another user.",
      );
    }

    const updated = await tx
      .update(radarOrder)
      .set({
        receiptAssetId: asset.id,
        status: "pending_review",
        reviewNote: null,
        submittedAt: now,
        reviewedAt: null,
        reviewedByUserId: null,
        updatedAt: now,
      })
      .where(eq(radarOrder.id, order.id))
      .returning()
      .get();
    await tx
      .update(mediaAsset)
      .set({ expiresAt: null, updatedAt: now })
      .where(eq(mediaAsset.id, asset.id));
    if (order.receiptAssetId && order.receiptAssetId !== asset.id) {
      await tx
        .update(mediaAsset)
        .set({ expiresAt: now, updatedAt: now })
        .where(eq(mediaAsset.id, order.receiptAssetId));
    }
    await emitAudit(tx, args.ctx, {
      action: "radar_order.update",
      entityType: "radar_order",
      entityId: order.id,
      before: publicOrder(order),
      after: publicOrder(updated),
    });
    return publicOrder(updated);
  });
}

export async function reviewRadarOrder(args: {
  ctx: ServiceContext;
  input: ReviewRadarOrderInput;
}) {
  requireScope(args.ctx, "write");
  const input = ReviewRadarOrderInput.parse(args.input);
  const reviewerUserId = requireUserId(args.ctx);

  return withTransaction(args.ctx, async (tx) => {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: tx });
    if (!access.isAdmin) {
      throw new ForbiddenError("Only administrators can review orders.");
    }
    const order = await tx
      .select()
      .from(radarOrder)
      .where(eq(radarOrder.id, input.orderId))
      .get();
    if (!order) throw new NotFoundError("radar_order", input.orderId);
    if (order.status !== "pending_review" || !order.receiptAssetId) {
      throw new PreconditionFailedError(
        "Only orders with a submitted receipt can be reviewed.",
      );
    }

    const now = new Date();
    const application = order.verificationApplicationId
      ? await tx
          .select({ status: radarVerificationApplication.status })
          .from(radarVerificationApplication)
          .where(
            eq(
              radarVerificationApplication.id,
              order.verificationApplicationId,
            ),
          )
          .get()
      : null;
    const approvedStatus =
      application?.status === "approved" ? "active" : "paid";
    const updated = await tx
      .update(radarOrder)
      .set({
        status: input.decision === "approved" ? approvedStatus : "rejected",
        reviewNote: input.reviewNote || null,
        reviewedByUserId: reviewerUserId,
        reviewedAt: now,
        paidAt: input.decision === "approved" ? now : order.paidAt,
        activatedAt:
          input.decision === "approved" && approvedStatus === "active"
            ? now
            : order.activatedAt,
        updatedAt: now,
      })
      .where(eq(radarOrder.id, order.id))
      .returning()
      .get();
    await emitAudit(tx, args.ctx, {
      action: "radar_order.update",
      entityType: "radar_order",
      entityId: order.id,
      before: publicOrder(order),
      after: publicOrder(updated),
    });
    return publicOrder(updated);
  });
}

export async function activatePaidRadarOrderForVerification(args: {
  ctx: ServiceContext;
  tx: DB;
  applicationId: number;
  activatedAt: Date;
}) {
  const order = await args.tx
    .select()
    .from(radarOrder)
    .where(
      and(
        eq(radarOrder.verificationApplicationId, args.applicationId),
        eq(radarOrder.type, "permanent_listing"),
        inArray(radarOrder.status, ["paid", "active"]),
      ),
    )
    .get();
  if (!order) {
    throw new PreconditionFailedError(
      "Confirm the permanent listing order before approving verification.",
    );
  }
  if (order.status === "active") return order;

  const updated = await args.tx
    .update(radarOrder)
    .set({
      status: "active",
      activatedAt: args.activatedAt,
      updatedAt: args.activatedAt,
    })
    .where(eq(radarOrder.id, order.id))
    .returning()
    .get();
  await emitAudit(args.tx, args.ctx, {
    action: "radar_order.update",
    entityType: "radar_order",
    entityId: order.id,
    before: publicOrder(order),
    after: publicOrder(updated),
  });
  return updated;
}
