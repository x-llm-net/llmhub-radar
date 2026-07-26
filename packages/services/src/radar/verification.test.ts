import { afterEach, expect, test } from "bun:test";

import { and, eq } from "@openstatus/db";
import {
  auditLog,
  mediaAsset,
  radarAccount,
  radarOrder,
  radarVerificationApplication,
  selectWorkspaceSchema,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { makeUserCtx, withTestTransaction } from "../../test/helpers";
import {
  createPermanentListingOrder,
  reviewRadarOrder,
  submitRadarOrderReceipt,
} from "./orders";
import {
  getRadarVerificationOverview,
  listRadarVerificationApplications,
  reviewRadarVerificationApplication,
  submitRadarVerificationApplication,
} from "./verification";

const previousAdminEmails = process.env.RADAR_ADMIN_EMAILS;

afterEach(() => {
  if (previousAdminEmails === undefined) {
    delete process.env.RADAR_ADMIN_EMAILS;
  } else {
    process.env.RADAR_ADMIN_EMAILS = previousAdminEmails;
  }
});

test.serial(
  "verification application completes the manual review loop",
  async () => {
    await withTestTransaction(async (tx) => {
      const suffix = crypto.randomUUID();
      const adminEmail = `verification-admin-${suffix}@example.com`;
      process.env.RADAR_ADMIN_EMAILS = adminEmail;

      const admin = await tx
        .insert(user)
        .values({ email: adminEmail, name: "Verification Admin" })
        .returning()
        .get();
      const applicant = await tx
        .insert(user)
        .values({
          email: `verification-owner-${suffix}@example.com`,
          name: "Verification Owner",
        })
        .returning()
        .get();
      const adminWorkspaceRow = await tx
        .insert(workspace)
        .values({
          slug: `verification-admin-${suffix}`,
          name: "Verification Admin",
          plan: "team",
        })
        .returning()
        .get();
      const applicantWorkspaceRow = await tx
        .insert(workspace)
        .values({
          slug: `verification-owner-${suffix}`,
          name: "Verification Owner",
          plan: "team",
        })
        .returning()
        .get();

      await tx.insert(usersToWorkspaces).values([
        {
          userId: admin.id,
          workspaceId: adminWorkspaceRow.id,
          role: "owner",
        },
        {
          userId: applicant.id,
          workspaceId: applicantWorkspaceRow.id,
          role: "owner",
        },
      ]);

      const applicantCtx = {
        ...makeUserCtx(selectWorkspaceSchema.parse(applicantWorkspaceRow), {
          userId: applicant.id,
        }),
        db: tx,
      };
      const adminCtx = {
        ...makeUserCtx(selectWorkspaceSchema.parse(adminWorkspaceRow), {
          userId: admin.id,
        }),
        db: tx,
      };

      const application = await submitRadarVerificationApplication({
        ctx: applicantCtx,
        input: {
          type: "personal",
          realName: "Test Owner",
          identityNumber: "320311199001010329",
          mobile: "13800138000",
        },
      });

      expect(application.status).toBe("pending");
      await expect(
        submitRadarVerificationApplication({
          ctx: applicantCtx,
          input: {
            type: "personal",
            realName: "Test Owner",
            identityNumber: "320311199001010329",
            mobile: "13800138000",
          },
        }),
      ).rejects.toThrow("already pending");

      const overview = await getRadarVerificationOverview({
        ctx: applicantCtx,
      });
      expect(overview.access.verificationStatus).toBe("pending");
      expect(overview.applications).toHaveLength(1);
      expect(overview.applications[0]?.identityNumberMasked).toBe(
        "3203**********0329",
      );
      expect(overview.applications[0]).not.toHaveProperty(
        "identityNumberEncrypted",
      );

      const pending = await listRadarVerificationApplications({
        ctx: adminCtx,
        input: { status: "pending", limit: 50, offset: 0 },
      });
      expect(pending.items.some((item) => item.id === application.id)).toBe(
        true,
      );
      const pendingApplication = pending.items.find(
        (item) => item.id === application.id,
      );
      expect(pendingApplication?.identityNumber).toBe("320311199001010329");
      expect(pendingApplication?.mobile).toBe("13800138000");
      expect(pendingApplication?.orderStatus).toBeNull();

      await expect(
        reviewRadarVerificationApplication({
          ctx: adminCtx,
          input: {
            applicationId: application.id,
            decision: "approved",
            reviewNote: "Identity confirmed.",
          },
        }),
      ).rejects.toThrow("Confirm the permanent listing order");

      const order = await createPermanentListingOrder({ ctx: applicantCtx });
      expect(order.status).toBe("pending_payment");
      expect(order.verificationApplicationId).toBe(application.id);

      const receiptAssetId = crypto.randomUUID();
      await tx.insert(mediaAsset).values({
        id: receiptAssetId,
        workspaceId: applicantWorkspaceRow.id,
        ownerUserId: applicant.id,
        purpose: "order_receipt",
        visibility: "private",
        storageKey: `order_receipt/${receiptAssetId}.png`,
        originalFilename: "payment.png",
        mimeType: "image/png",
        sizeBytes: 128,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await submitRadarOrderReceipt({
        ctx: applicantCtx,
        input: { orderId: order.id, receiptAssetId },
      });
      const paidOrder = await reviewRadarOrder({
        ctx: adminCtx,
        input: {
          orderId: order.id,
          decision: "approved",
          reviewNote: "Payment received.",
        },
      });
      expect(paidOrder.status).toBe("paid");

      const payableApplication = await listRadarVerificationApplications({
        ctx: adminCtx,
        input: { status: "pending", limit: 50, offset: 0 },
      });
      expect(
        payableApplication.items.find((item) => item.id === application.id)
          ?.orderStatus,
      ).toBe("paid");

      await reviewRadarVerificationApplication({
        ctx: adminCtx,
        input: {
          applicationId: application.id,
          decision: "approved",
          reviewNote: "Ownership and fee confirmed.",
        },
      });

      const account = await tx
        .select()
        .from(radarAccount)
        .where(eq(radarAccount.userId, applicant.id))
        .get();
      expect(account?.verificationStatus).toBe("verified");

      const reviewed = await tx
        .select()
        .from(radarVerificationApplication)
        .where(eq(radarVerificationApplication.id, application.id))
        .get();
      expect(reviewed?.status).toBe("approved");
      expect(reviewed?.paymentConfirmedAt).toBeInstanceOf(Date);
      expect(reviewed?.identityNumberEncrypted).toBeNull();
      expect(reviewed?.mobileEncrypted).toBeNull();
      const activeOrder = await tx
        .select()
        .from(radarOrder)
        .where(eq(radarOrder.id, order.id))
        .get();
      expect(activeOrder?.status).toBe("active");
      const personalOverview = await getRadarVerificationOverview({
        ctx: applicantCtx,
      });
      expect(personalOverview.activeVerificationType).toBe("personal");

      const rejectedUpgrade = await submitRadarVerificationApplication({
        ctx: applicantCtx,
        input: {
          type: "enterprise",
          companyName: "Upgrade Test Company",
          creditCode: "91320100MA1A2B3C4D",
          legalRepresentativeName: "Test Owner",
          identityNumber: "320311199001010329",
        },
      });
      const accountDuringUpgrade = await tx
        .select()
        .from(radarAccount)
        .where(eq(radarAccount.userId, applicant.id))
        .get();
      expect(accountDuringUpgrade?.verificationStatus).toBe("verified");

      const pendingUpgrade = await listRadarVerificationApplications({
        ctx: adminCtx,
        input: { status: "pending", limit: 50, offset: 0 },
      });
      expect(
        pendingUpgrade.items.find((item) => item.id === rejectedUpgrade.id)
          ?.isUpgrade,
      ).toBe(true);

      await reviewRadarVerificationApplication({
        ctx: adminCtx,
        input: {
          applicationId: rejectedUpgrade.id,
          decision: "rejected",
          reviewNote: "Enterprise details need correction.",
        },
      });
      const accountAfterRejectedUpgrade = await tx
        .select()
        .from(radarAccount)
        .where(eq(radarAccount.userId, applicant.id))
        .get();
      expect(accountAfterRejectedUpgrade?.verificationStatus).toBe("verified");

      const approvedUpgrade = await submitRadarVerificationApplication({
        ctx: applicantCtx,
        input: {
          type: "enterprise",
          companyName: "Upgrade Test Company",
          creditCode: "91320100MA1A2B3C5D",
          legalRepresentativeName: "Test Owner",
          identityNumber: "320311199001010329",
        },
      });
      await reviewRadarVerificationApplication({
        ctx: adminCtx,
        input: {
          applicationId: approvedUpgrade.id,
          decision: "approved",
          reviewNote: "Enterprise details confirmed.",
        },
      });

      const accountAfterApprovedUpgrade = await tx
        .select()
        .from(radarAccount)
        .where(eq(radarAccount.userId, applicant.id))
        .get();
      expect(accountAfterApprovedUpgrade?.verificationStatus).toBe("verified");
      const reviewedUpgrade = await tx
        .select()
        .from(radarVerificationApplication)
        .where(eq(radarVerificationApplication.id, approvedUpgrade.id))
        .get();
      expect(reviewedUpgrade?.status).toBe("approved");
      expect(reviewedUpgrade?.paymentConfirmedAt).toBeNull();
      expect(reviewedUpgrade?.identityNumberEncrypted).toBeNull();
      const enterpriseOverview = await getRadarVerificationOverview({
        ctx: applicantCtx,
      });
      expect(enterpriseOverview.activeVerificationType).toBe("enterprise");

      const createAudit = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "radar_verification_application.create"),
            eq(auditLog.entityId, String(application.id)),
          ),
        )
        .get();
      const updateAudit = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "radar_verification_application.update"),
            eq(auditLog.entityId, String(application.id)),
          ),
        )
        .get();
      expect(createAudit?.actorUserId).toBe(applicant.id);
      expect(updateAudit?.actorUserId).toBe(admin.id);
      expect(createAudit?.after).not.toHaveProperty("identityNumberEncrypted");
      expect(createAudit?.after).not.toHaveProperty("identityNumberHash");
    });
  },
);
