import { expect, test } from "bun:test";

import { and, eq } from "@openstatus/db";
import {
  mediaAsset,
  radarAccount,
  radarClaimApplication,
  radarClaimApplicationEvidence,
  radarPool,
  selectWorkspaceSchema,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { makeUserCtx, withTestTransaction } from "../../test/helpers";
import { getRadarActorAccess } from "./access";
import {
  reviewRadarClaimApplication,
  submitRadarClaimApplication,
} from "./claims";

test.serial(
  "claim review reserves quota and transfers ownership only after approval",
  async () => {
    const previousAdminEmails = process.env.RADAR_ADMIN_EMAILS;

    try {
      await withTestTransaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const adminEmail = `claim-review-admin-${suffix}@example.com`;
        process.env.RADAR_ADMIN_EMAILS = adminEmail;

        const [admin, firstApplicant, secondApplicant] = await tx
          .insert(user)
          .values([
            { email: adminEmail, name: "Claim Review Admin" },
            {
              email: `claim-review-first-${suffix}@example.com`,
              name: "First Applicant",
            },
            {
              email: `claim-review-second-${suffix}@example.com`,
              name: "Second Applicant",
            },
          ])
          .returning()
          .all();
        expect(admin).toBeDefined();
        expect(firstApplicant).toBeDefined();
        expect(secondApplicant).toBeDefined();
        if (!admin || !firstApplicant || !secondApplicant) return;

        const [adminWorkspace, firstWorkspace, secondWorkspace] = await tx
          .insert(workspace)
          .values([
            {
              slug: `claim-review-admin-${suffix}`,
              name: "Claim Review Admin",
              plan: "team",
            },
            {
              slug: `claim-review-first-${suffix}`,
              name: "First Applicant",
              plan: "team",
            },
            {
              slug: `claim-review-second-${suffix}`,
              name: "Second Applicant",
              plan: "team",
            },
          ])
          .returning()
          .all();
        expect(adminWorkspace).toBeDefined();
        expect(firstWorkspace).toBeDefined();
        expect(secondWorkspace).toBeDefined();
        if (!adminWorkspace || !firstWorkspace || !secondWorkspace) return;

        await tx.insert(usersToWorkspaces).values([
          {
            userId: admin.id,
            workspaceId: adminWorkspace.id,
            role: "owner",
          },
          {
            userId: firstApplicant.id,
            workspaceId: firstWorkspace.id,
            role: "owner",
          },
          {
            userId: secondApplicant.id,
            workspaceId: secondWorkspace.id,
            role: "owner",
          },
        ]);
        await tx.insert(radarAccount).values([
          {
            userId: firstApplicant.id,
            verificationStatus: "verified",
          },
          {
            userId: secondApplicant.id,
            verificationStatus: "verified",
          },
        ]);

        await tx.insert(radarPool).values([
          {
            workspaceId: firstWorkspace.id,
            ownerUserId: firstApplicant.id,
            name: "Existing Provider One",
            slug: `existing-one-${suffix}`,
          },
          {
            workspaceId: firstWorkspace.id,
            ownerUserId: firstApplicant.id,
            name: "Existing Provider Two",
            slug: `existing-two-${suffix}`,
          },
        ]);
        const [approvedPool, rejectedPool] = await tx
          .insert(radarPool)
          .values([
            {
              workspaceId: adminWorkspace.id,
              ownerUserId: admin.id,
              claimable: true,
              name: "Approved Claim Provider",
              slug: `approved-claim-${suffix}`,
              visibility: "public",
              publicPoolOptIn: true,
            },
            {
              workspaceId: adminWorkspace.id,
              ownerUserId: admin.id,
              claimable: true,
              name: "Rejected Claim Provider",
              slug: `rejected-claim-${suffix}`,
              visibility: "public",
              publicPoolOptIn: true,
            },
          ])
          .returning()
          .all();
        expect(approvedPool).toBeDefined();
        expect(rejectedPool).toBeDefined();
        if (!approvedPool || !rejectedPool) return;

        const adminCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(adminWorkspace), {
            userId: admin.id,
          }),
          db: tx,
        };
        const firstApplicantCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(firstWorkspace), {
            userId: firstApplicant.id,
          }),
          db: tx,
        };
        const secondApplicantCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(secondWorkspace), {
            userId: secondApplicant.id,
          }),
          db: tx,
        };

        const evidenceAssetId = crypto.randomUUID();
        await tx.insert(mediaAsset).values({
          id: evidenceAssetId,
          workspaceId: firstWorkspace.id,
          ownerUserId: firstApplicant.id,
          purpose: "claim_evidence",
          visibility: "private",
          storageKey: `claim_evidence/${evidenceAssetId}.png`,
          originalFilename: "evidence.png",
          mimeType: "image/png",
          sizeBytes: 128,
          expiresAt: new Date(Date.now() + 60_000),
        });

        const firstApplication = await submitRadarClaimApplication({
          ctx: firstApplicantCtx,
          input: {
            poolId: approvedPool.id,
            proof: "Ownership proof from the first applicant.",
            evidenceAssetIds: [evidenceAssetId],
          },
        });
        expect(firstApplication.evidenceImageUrls).toEqual([]);
        const evidenceLink = await tx
          .select()
          .from(radarClaimApplicationEvidence)
          .where(
            eq(
              radarClaimApplicationEvidence.applicationId,
              firstApplication.id,
            ),
          )
          .get();
        expect(evidenceLink).toMatchObject({
          assetId: evidenceAssetId,
          sortOrder: 0,
        });
        const competingApplication = await submitRadarClaimApplication({
          ctx: secondApplicantCtx,
          input: {
            poolId: approvedPool.id,
            proof: "Competing ownership proof from the second applicant.",
          },
        });

        const firstAccessWhilePending = await getRadarActorAccess({
          ctx: firstApplicantCtx,
          db: tx,
        });
        expect(firstAccessWhilePending).toMatchObject({
          ownedCount: 2,
          pendingClaimCount: 1,
          providerUsage: 3,
          providerLimit: 3,
          canCreate: false,
        });

        const beforeReview = await tx
          .select()
          .from(radarPool)
          .where(eq(radarPool.id, approvedPool.id))
          .get();
        expect(beforeReview).toMatchObject({
          ownerUserId: admin.id,
          workspaceId: adminWorkspace.id,
          claimable: true,
        });

        await reviewRadarClaimApplication({
          ctx: adminCtx,
          input: {
            applicationId: firstApplication.id,
            decision: "approved",
            reviewNote: "Ownership confirmed.",
          },
        });

        const [afterApproval, reviewedApplications] = await Promise.all([
          tx
            .select()
            .from(radarPool)
            .where(eq(radarPool.id, approvedPool.id))
            .get(),
          tx
            .select()
            .from(radarClaimApplication)
            .where(
              and(
                eq(radarClaimApplication.poolId, approvedPool.id),
                eq(radarClaimApplication.status, "rejected"),
              ),
            )
            .all(),
        ]);
        expect(afterApproval).toMatchObject({
          ownerUserId: firstApplicant.id,
          workspaceId: firstWorkspace.id,
          claimable: false,
        });
        expect(
          reviewedApplications.map((application) => application.id),
        ).toEqual([competingApplication.id]);

        const firstAccessAfterApproval = await getRadarActorAccess({
          ctx: firstApplicantCtx,
          db: tx,
        });
        expect(firstAccessAfterApproval).toMatchObject({
          ownedCount: 3,
          pendingClaimCount: 0,
          providerUsage: 3,
          canCreate: false,
        });

        const expiredAssetId = crypto.randomUUID();
        await tx.insert(mediaAsset).values({
          id: expiredAssetId,
          workspaceId: secondWorkspace.id,
          ownerUserId: secondApplicant.id,
          purpose: "claim_evidence",
          visibility: "private",
          storageKey: `claim_evidence/${expiredAssetId}.png`,
          originalFilename: "expired-evidence.png",
          mimeType: "image/png",
          sizeBytes: 128,
          expiresAt: new Date(Date.now() - 60_000),
        });
        await expect(
          submitRadarClaimApplication({
            ctx: secondApplicantCtx,
            input: {
              poolId: rejectedPool.id,
              proof: "Ownership proof with expired evidence.",
              evidenceAssetIds: [expiredAssetId],
            },
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        const rejectedApplication = await submitRadarClaimApplication({
          ctx: secondApplicantCtx,
          input: {
            poolId: rejectedPool.id,
            proof: "Ownership proof that will be rejected by the reviewer.",
          },
        });
        await reviewRadarClaimApplication({
          ctx: adminCtx,
          input: {
            applicationId: rejectedApplication.id,
            decision: "rejected",
            reviewNote: "The submitted proof is insufficient.",
          },
        });

        const afterRejection = await tx
          .select()
          .from(radarPool)
          .where(eq(radarPool.id, rejectedPool.id))
          .get();
        expect(afterRejection).toMatchObject({
          ownerUserId: admin.id,
          workspaceId: adminWorkspace.id,
          claimable: true,
        });
        const secondAccessAfterRejection = await getRadarActorAccess({
          ctx: secondApplicantCtx,
          db: tx,
        });
        expect(secondAccessAfterRejection).toMatchObject({
          ownedCount: 0,
          pendingClaimCount: 0,
          providerUsage: 0,
          canCreate: true,
        });
      });
    } finally {
      if (previousAdminEmails === undefined) {
        delete process.env.RADAR_ADMIN_EMAILS;
      } else {
        process.env.RADAR_ADMIN_EMAILS = previousAdminEmails;
      }
    }
  },
);
