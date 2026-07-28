import { expect, test } from "bun:test";

import { eq } from "@openstatus/db";
import {
  page,
  radarCredential,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
  radarTargetStatus,
  selectWorkspaceSchema,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { makeUserCtx, withTestTransaction } from "../../test/helpers";
import { deleteRadarCredential, deleteRadarPool } from "./create";
import { getRadarPool, listRadarPools } from "./list";

test.serial(
  "radar deletion archives providers and physically removes credentials",
  async () => {
    await withTestTransaction(async (tx) => {
      const suffix = crypto.randomUUID();
      const owner = await tx
        .insert(user)
        .values({
          email: `radar-delete-${suffix}@example.com`,
          name: "Radar Delete Owner",
        })
        .returning()
        .get();
      const workspaceRow = await tx
        .insert(workspace)
        .values({
          slug: `radar-delete-${suffix}`,
          name: "Radar Delete Workspace",
          plan: "team",
        })
        .returning()
        .get();
      await tx.insert(usersToWorkspaces).values({
        userId: owner.id,
        workspaceId: workspaceRow.id,
        role: "owner",
      });

      const publicPage = await tx
        .insert(page)
        .values({
          workspaceId: workspaceRow.id,
          title: "Delete Test Provider",
          description: "Delete test",
          slug: `radar-delete-page-${suffix}`,
          customDomain: "",
          published: true,
          accessType: "public",
        })
        .returning()
        .get();
      const pool = await tx
        .insert(radarPool)
        .values({
          workspaceId: workspaceRow.id,
          ownerUserId: owner.id,
          name: "Delete Test Provider",
          slug: `radar-delete-provider-${suffix}`,
          visibility: "public",
          publicPoolOptIn: true,
          pageId: publicPage.id,
        })
        .returning()
        .get();
      const provider = await tx
        .insert(radarProvider)
        .values({
          workspaceId: workspaceRow.id,
          poolId: pool.id,
          name: "Delete Test Provider",
          displayName: "Delete Test Provider",
          baseUrlEncrypted: "encrypted-base-url",
          baseUrlHostHash: `host-${suffix}`,
        })
        .returning()
        .get();
      const [retainedCredential, handoverCredential] = await tx
        .insert(radarCredential)
        .values([
          {
            workspaceId: workspaceRow.id,
            providerId: provider.id,
            name: "Retained Key",
            encryptedApiKey: "encrypted-retained-key",
            keyFingerprint: `retained-${suffix}`,
            lastFour: "1111",
          },
          {
            workspaceId: workspaceRow.id,
            providerId: provider.id,
            name: "Handover Key",
            encryptedApiKey: "encrypted-handover-key",
            keyFingerprint: `handover-${suffix}`,
            lastFour: "2222",
            handoverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        ])
        .returning()
        .all();
      expect(retainedCredential).toBeDefined();
      expect(handoverCredential).toBeDefined();
      if (!retainedCredential || !handoverCredential) return;

      const [retainedTarget, handoverTarget] = await tx
        .insert(radarProbeTarget)
        .values([
          {
            workspaceId: workspaceRow.id,
            poolId: pool.id,
            providerId: provider.id,
            credentialId: retainedCredential.id,
            name: "Retained target",
            displayName: "Retained target",
            modelName: "gpt-retained",
            currentStatus: "operational",
            nextCheckAt: new Date(),
          },
          {
            workspaceId: workspaceRow.id,
            poolId: pool.id,
            providerId: provider.id,
            credentialId: handoverCredential.id,
            name: "Handover target",
            displayName: "Handover target",
            modelName: "gpt-handover",
            currentStatus: "operational",
            nextCheckAt: new Date(),
          },
        ])
        .returning()
        .all();
      expect(retainedTarget).toBeDefined();
      expect(handoverTarget).toBeDefined();
      if (!retainedTarget || !handoverTarget) return;

      await tx.insert(radarTargetStatus).values([
        {
          workspaceId: workspaceRow.id,
          targetId: retainedTarget.id,
          currentStatus: "operational",
        },
        {
          workspaceId: workspaceRow.id,
          targetId: handoverTarget.id,
          currentStatus: "operational",
        },
      ]);
      const [retainedRun, handoverRun] = await tx
        .insert(radarProbeRun)
        .values([
          {
            workspaceId: workspaceRow.id,
            poolId: pool.id,
            providerId: provider.id,
            targetId: retainedTarget.id,
            startedAt: new Date(),
            success: true,
          },
          {
            workspaceId: workspaceRow.id,
            poolId: pool.id,
            providerId: provider.id,
            targetId: handoverTarget.id,
            startedAt: new Date(),
            success: true,
          },
        ])
        .returning()
        .all();
      expect(retainedRun).toBeDefined();
      expect(handoverRun).toBeDefined();
      if (!retainedRun || !handoverRun) return;

      const ctx = {
        ...makeUserCtx(selectWorkspaceSchema.parse(workspaceRow), {
          userId: owner.id,
        }),
        db: tx,
      };

      await deleteRadarCredential({
        ctx,
        input: {
          poolSlug: pool.slug,
          credentialId: handoverCredential.id,
        },
      });

      expect(
        await tx
          .select()
          .from(radarCredential)
          .where(eq(radarCredential.id, handoverCredential.id))
          .get(),
      ).toBeUndefined();
      expect(
        await tx
          .select()
          .from(radarProbeTarget)
          .where(eq(radarProbeTarget.id, handoverTarget.id))
          .get(),
      ).toBeUndefined();
      expect(
        await tx
          .select()
          .from(radarProbeRun)
          .where(eq(radarProbeRun.id, handoverRun.id))
          .get(),
      ).toBeUndefined();

      await deleteRadarPool({
        ctx,
        input: { poolSlug: pool.slug },
      });

      const [archivedPool, disabledProvider, disabledCredential, pausedTarget] =
        await Promise.all([
          tx.select().from(radarPool).where(eq(radarPool.id, pool.id)).get(),
          tx
            .select()
            .from(radarProvider)
            .where(eq(radarProvider.id, provider.id))
            .get(),
          tx
            .select()
            .from(radarCredential)
            .where(eq(radarCredential.id, retainedCredential.id))
            .get(),
          tx
            .select()
            .from(radarProbeTarget)
            .where(eq(radarProbeTarget.id, retainedTarget.id))
            .get(),
        ]);
      expect(archivedPool?.deletedAt).toBeInstanceOf(Date);
      expect(archivedPool?.publicPoolOptIn).toBe(false);
      expect(archivedPool?.visibility).toBe("private");
      expect(disabledProvider?.enabled).toBe(false);
      expect(disabledCredential?.enabled).toBe(false);
      expect(pausedTarget?.enabled).toBe(false);
      expect(pausedTarget?.currentStatus).toBe("paused");
      expect(pausedTarget?.nextCheckAt).toBeNull();

      const retainedHistory = await tx
        .select()
        .from(radarProbeRun)
        .where(eq(radarProbeRun.id, retainedRun.id))
        .get();
      const unpublishedPage = await tx
        .select()
        .from(page)
        .where(eq(page.id, publicPage.id))
        .get();
      expect(retainedHistory).toBeDefined();
      expect(unpublishedPage?.published).toBe(false);

      const list = await listRadarPools({ ctx });
      expect(list.items).toHaveLength(0);
      await expect(
        getRadarPool({ ctx, input: { slug: pool.slug } }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  },
);

test.serial(
  "administrator deletes credentials and pools owned by another workspace",
  async () => {
    const previousAdminEmails = process.env.RADAR_ADMIN_EMAILS;

    try {
      await withTestTransaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const adminEmail = `radar-delete-admin-${suffix}@example.com`;
        process.env.RADAR_ADMIN_EMAILS = adminEmail;

        const [admin, owner] = await tx
          .insert(user)
          .values([
            { email: adminEmail, name: "Radar Delete Admin" },
            {
              email: `radar-delete-owner-${suffix}@example.com`,
              name: "Radar Delete Owner",
            },
          ])
          .returning()
          .all();
        const [adminWorkspace, ownerWorkspace] = await tx
          .insert(workspace)
          .values([
            {
              slug: `radar-delete-admin-${suffix}`,
              name: "Radar Delete Admin Workspace",
              plan: "team",
            },
            {
              slug: `radar-delete-owner-${suffix}`,
              name: "Radar Delete Owner Workspace",
              plan: "team",
            },
          ])
          .returning()
          .all();
        expect(admin).toBeDefined();
        expect(owner).toBeDefined();
        expect(adminWorkspace).toBeDefined();
        expect(ownerWorkspace).toBeDefined();
        if (!admin || !owner || !adminWorkspace || !ownerWorkspace) return;

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
        const pool = await tx
          .insert(radarPool)
          .values({
            workspaceId: ownerWorkspace.id,
            ownerUserId: owner.id,
            name: "Cross-workspace Delete Provider",
            slug: `cross-workspace-delete-${suffix}`,
            visibility: "public",
            publicPoolOptIn: true,
          })
          .returning()
          .get();
        const provider = await tx
          .insert(radarProvider)
          .values({
            workspaceId: ownerWorkspace.id,
            poolId: pool.id,
            name: "Cross-workspace Delete Provider",
            displayName: "Cross-workspace Delete Provider",
            baseUrlEncrypted: "encrypted-base-url",
            baseUrlHostHash: `cross-workspace-host-${suffix}`,
          })
          .returning()
          .get();
        const credential = await tx
          .insert(radarCredential)
          .values({
            workspaceId: ownerWorkspace.id,
            providerId: provider.id,
            name: "Platform Handover Key",
            encryptedApiKey: "encrypted-handover-key",
            keyFingerprint: `cross-workspace-key-${suffix}`,
            lastFour: "2222",
            handoverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          })
          .returning()
          .get();
        const adminCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(adminWorkspace), {
            userId: admin.id,
          }),
          db: tx,
        };

        await deleteRadarCredential({
          ctx: adminCtx,
          input: {
            poolSlug: pool.slug,
            credentialId: credential.id,
          },
        });
        expect(
          await tx
            .select()
            .from(radarCredential)
            .where(eq(radarCredential.id, credential.id))
            .get(),
        ).toBeUndefined();

        await deleteRadarPool({
          ctx: adminCtx,
          input: { poolSlug: pool.slug },
        });
        expect(
          await tx
            .select({ deletedAt: radarPool.deletedAt })
            .from(radarPool)
            .where(eq(radarPool.id, pool.id))
            .get(),
        ).toMatchObject({ deletedAt: expect.any(Date) });
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
