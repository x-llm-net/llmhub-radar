import { expect, test } from "bun:test";

import { and, eq } from "@openstatus/db";
import {
  auditLog,
  radarAccount,
  radarCredential,
  radarPool,
  radarProbeTarget,
  radarProvider,
  radarTargetStatus,
  selectWorkspaceSchema,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { makeUserCtx, withTestTransaction } from "../../test/helpers";
import {
  reviewRadarClaimApplication,
  submitRadarClaimApplication,
} from "./claims";
import { updateRadarTokenProbe } from "./create";
import { retireExpiredRadarCredentialHandovers } from "./cron";
import { encryptSecret, hashSecret } from "./crypto";
import { transferRadarPoolOwnership } from "./ownership";

test.serial(
  "ownership transfer writes one audit record in the admin workspace",
  async () => {
    const previousAdminEmails = process.env.RADAR_ADMIN_EMAILS;

    try {
      await withTestTransaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const adminEmail = `radar-admin-${suffix}@example.com`;
        process.env.RADAR_ADMIN_EMAILS = adminEmail;

        const admin = await tx
          .insert(user)
          .values({ email: adminEmail, name: "Radar Admin" })
          .returning()
          .get();
        const owner = await tx
          .insert(user)
          .values({
            email: `radar-owner-${suffix}@example.com`,
            name: "Radar Owner",
          })
          .returning()
          .get();

        const adminWorkspaceRow = await tx
          .insert(workspace)
          .values({
            slug: `radar-admin-${suffix}`,
            name: "Radar Admin",
            plan: "team",
          })
          .returning()
          .get();
        const ownerWorkspace = await tx
          .insert(workspace)
          .values({
            slug: `radar-owner-${suffix}`,
            name: "Radar Owner",
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
            userId: owner.id,
            workspaceId: ownerWorkspace.id,
            role: "owner",
          },
        ]);

        const pool = await tx
          .insert(radarPool)
          .values({
            workspaceId: adminWorkspaceRow.id,
            ownerUserId: admin.id,
            claimable: true,
            name: "Audit Test Provider",
            slug: `audit-test-${suffix}`,
            visibility: "public",
            publicPoolOptIn: true,
          })
          .returning()
          .get();

        const adminWorkspace = selectWorkspaceSchema.parse(adminWorkspaceRow);
        const ctx = {
          ...makeUserCtx(adminWorkspace, { userId: admin.id }),
          db: tx,
        };

        const updated = await transferRadarPoolOwnership({
          ctx,
          input: { poolId: pool.id, ownerUserId: owner.id },
        });

        expect(updated.workspaceId).toBe(ownerWorkspace.id);
        expect(updated.ownerUserId).toBe(owner.id);
        expect(updated.claimable).toBe(false);

        const rows = await tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.workspaceId, adminWorkspaceRow.id),
              eq(auditLog.entityType, "radar_pool"),
              eq(auditLog.entityId, String(pool.id)),
            ),
          )
          .all();

        expect(rows).toHaveLength(1);
        expect(rows[0]?.action).toBe("radar_pool.update");
        expect(rows[0]?.actorUserId).toBe(admin.id);
        expect(rows[0]?.changedFields).toEqual([
          "workspaceId",
          "ownerUserId",
          "claimable",
        ]);
        expect(rows[0]?.before).toMatchObject({
          workspaceId: adminWorkspaceRow.id,
          ownerUserId: admin.id,
          claimable: true,
        });
        expect(rows[0]?.after).toMatchObject({
          workspaceId: ownerWorkspace.id,
          ownerUserId: owner.id,
          claimable: false,
        });

        await transferRadarPoolOwnership({
          ctx,
          input: { poolId: pool.id, ownerUserId: owner.id },
        });

        const rowsAfterNoop = await tx
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.workspaceId, adminWorkspaceRow.id),
              eq(auditLog.entityType, "radar_pool"),
              eq(auditLog.entityId, String(pool.id)),
            ),
          )
          .all();

        expect(rowsAfterNoop).toHaveLength(1);
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

test.serial(
  "verified owner claims a provider and safely replaces handover credentials",
  async () => {
    const previousAdminEmails = process.env.RADAR_ADMIN_EMAILS;

    try {
      await withTestTransaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const adminEmail = `claim-admin-${suffix}@example.com`;
        process.env.RADAR_ADMIN_EMAILS = adminEmail;
        const admin = await tx
          .insert(user)
          .values({
            email: adminEmail,
            name: "Claim Admin",
          })
          .returning()
          .get();
        const owner = await tx
          .insert(user)
          .values({
            email: `claim-owner-${suffix}@example.com`,
            name: "Claim Owner",
          })
          .returning()
          .get();
        const adminWorkspace = await tx
          .insert(workspace)
          .values({
            slug: `claim-admin-${suffix}`,
            name: "Claim Admin",
            plan: "team",
          })
          .returning()
          .get();
        const ownerWorkspace = await tx
          .insert(workspace)
          .values({
            slug: `claim-owner-${suffix}`,
            name: "Claim Owner",
            plan: "team",
          })
          .returning()
          .get();

        await tx.insert(usersToWorkspaces).values([
          {
            userId: admin.id,
            workspaceId: adminWorkspace.id,
            role: "owner",
          },
          {
            userId: owner.id,
            workspaceId: ownerWorkspace.id,
            role: "owner",
          },
        ]);
        await tx.insert(radarAccount).values({
          userId: owner.id,
          verificationStatus: "verified",
        });

        const pool = await tx
          .insert(radarPool)
          .values({
            workspaceId: adminWorkspace.id,
            ownerUserId: admin.id,
            claimable: true,
            name: "Claimable Provider",
            slug: `claimable-${suffix}`,
            visibility: "public",
            publicPoolOptIn: true,
          })
          .returning()
          .get();
        const provider = await tx
          .insert(radarProvider)
          .values({
            workspaceId: adminWorkspace.id,
            poolId: pool.id,
            name: "Claimable Provider",
            displayName: "Claimable Provider",
            baseUrlEncrypted: await encryptSecret("https://example.com/v1"),
            baseUrlHostHash: await hashSecret("example.com"),
          })
          .returning()
          .get();
        const credentials = await tx
          .insert(radarCredential)
          .values([
            {
              workspaceId: adminWorkspace.id,
              providerId: provider.id,
              name: "Primary",
              encryptedApiKey: await encryptSecret("platform-key-primary"),
              keyFingerprint: await hashSecret("platform-key-primary"),
              lastFour: "mary",
              billingGroup: "Primary",
              modelGroup: "OpenAI",
            },
            {
              workspaceId: adminWorkspace.id,
              providerId: provider.id,
              name: "Fallback",
              encryptedApiKey: await encryptSecret("platform-key-fallback"),
              keyFingerprint: await hashSecret("platform-key-fallback"),
              lastFour: "back",
              billingGroup: "Fallback",
              modelGroup: "Claude",
            },
            {
              workspaceId: adminWorkspace.id,
              providerId: provider.id,
              name: "Dormant",
              encryptedApiKey: "",
              keyFingerprint: "",
              lastFour: "",
              billingGroup: "Dormant",
              modelGroup: "OpenAI",
              enabled: false,
            },
          ])
          .returning()
          .all();
        const primaryCredential = credentials[0];
        const fallbackCredential = credentials[1];
        const dormantCredential = credentials[2];
        expect(primaryCredential).toBeDefined();
        expect(fallbackCredential).toBeDefined();
        expect(dormantCredential).toBeDefined();
        if (!primaryCredential || !fallbackCredential || !dormantCredential)
          return;

        const targets = await tx
          .insert(radarProbeTarget)
          .values([
            {
              workspaceId: adminWorkspace.id,
              poolId: pool.id,
              providerId: provider.id,
              credentialId: primaryCredential.id,
              name: "Primary / gpt-test",
              displayName: "Primary",
              modelName: "gpt-test",
            },
            {
              workspaceId: adminWorkspace.id,
              poolId: pool.id,
              providerId: provider.id,
              credentialId: fallbackCredential.id,
              name: "Fallback / claude-test",
              displayName: "Fallback",
              modelName: "claude-test",
            },
            {
              workspaceId: adminWorkspace.id,
              poolId: pool.id,
              providerId: provider.id,
              credentialId: dormantCredential.id,
              name: "Dormant / gpt-test",
              displayName: "Dormant",
              modelName: "gpt-test",
            },
          ])
          .returning()
          .all();
        await tx.insert(radarTargetStatus).values(
          targets.map((target) => ({
            workspaceId: adminWorkspace.id,
            targetId: target.id,
            currentStatus: "operational" as const,
          })),
        );

        const ownerCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(ownerWorkspace), {
            userId: owner.id,
          }),
          db: tx,
        };
        const adminCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(adminWorkspace), {
            userId: admin.id,
          }),
          db: tx,
        };
        const claimedAt = new Date();
        const application = await submitRadarClaimApplication({
          ctx: ownerCtx,
          input: {
            poolId: pool.id,
            proof: "Provider ownership proof for the claim test.",
          },
        });
        await reviewRadarClaimApplication({
          ctx: adminCtx,
          input: {
            applicationId: application.id,
            decision: "approved",
            reviewNote: "Ownership confirmed.",
          },
        });
        const claimed = await tx
          .select()
          .from(radarPool)
          .where(eq(radarPool.id, pool.id))
          .get();
        expect(claimed).toBeDefined();
        if (!claimed) return;
        expect(claimed.ownerUserId).toBe(owner.id);
        expect(claimed.workspaceId).toBe(ownerWorkspace.id);
        expect(claimed.claimable).toBe(false);

        const handoverCredential = await tx
          .select()
          .from(radarCredential)
          .where(eq(radarCredential.id, primaryCredential.id))
          .get();
        expect(handoverCredential?.workspaceId).toBe(ownerWorkspace.id);
        expect(handoverCredential?.enabled).toBe(true);
        expect(
          handoverCredential?.handoverExpiresAt?.getTime(),
        ).toBeGreaterThan(claimedAt.getTime() + 23 * 60 * 60 * 1000);

        const dormantAfterClaim = await tx
          .select()
          .from(radarCredential)
          .where(eq(radarCredential.id, dormantCredential.id))
          .get();
        expect(
          dormantAfterClaim?.handoverExpiresAt?.getTime(),
        ).toBeLessThanOrEqual(Date.now());
        expect(dormantAfterClaim?.enabled).toBe(false);
        const dormantTarget = targets.find(
          (target) => target.credentialId === dormantCredential.id,
        );
        const pausedDormantTarget = dormantTarget
          ? await tx
              .select()
              .from(radarProbeTarget)
              .where(eq(radarProbeTarget.id, dormantTarget.id))
              .get()
          : null;
        expect(pausedDormantTarget?.currentStatus).toBe("paused");

        await updateRadarTokenProbe({
          ctx: ownerCtx,
          input: {
            poolSlug: pool.slug,
            credentialId: primaryCredential.id,
            apiKeyName: "Primary",
            apiKey: "owner-key-new-7788",
            modelType: "OpenAI",
            probeModel: "gpt-test",
            availableModels: ["gpt-test"],
          },
        });
        const replacedCredential = await tx
          .select()
          .from(radarCredential)
          .where(eq(radarCredential.id, primaryCredential.id))
          .get();
        expect(replacedCredential?.handoverExpiresAt).toBeNull();
        expect(replacedCredential?.lastFour).toBe("7788");
        expect(replacedCredential?.enabled).toBe(true);

        const expiredAt = new Date(Date.now() - 1000);
        await tx
          .update(radarCredential)
          .set({ handoverExpiresAt: expiredAt })
          .where(eq(radarCredential.id, fallbackCredential.id));
        const retired = await retireExpiredRadarCredentialHandovers({
          now: new Date(),
          db: tx,
        });
        expect(retired).toBe(1);
        const retiredCredential = await tx
          .select()
          .from(radarCredential)
          .where(eq(radarCredential.id, fallbackCredential.id))
          .get();
        expect(retiredCredential?.encryptedApiKey).toBe("");
        expect(retiredCredential?.enabled).toBe(false);

        const fallbackTarget = targets.find(
          (target) => target.credentialId === fallbackCredential.id,
        );
        const pausedTarget = fallbackTarget
          ? await tx
              .select()
              .from(radarProbeTarget)
              .where(eq(radarProbeTarget.id, fallbackTarget.id))
              .get()
          : null;
        expect(pausedTarget?.currentStatus).toBe("paused");

        const claimAudit = await tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.action, "radar_pool.claim"),
              eq(auditLog.entityId, String(pool.id)),
            ),
          )
          .get();
        expect(claimAudit?.actorUserId).toBe(admin.id);
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
