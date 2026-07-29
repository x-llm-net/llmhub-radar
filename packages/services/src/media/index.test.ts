import { expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@openstatus/db";
import {
  mediaAsset,
  page,
  selectWorkspaceSchema,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { makeUserCtx, withTestTransaction } from "../../test/helpers";
import {
  createMediaAsset,
  deleteMediaAsset,
  detectMediaMimeType,
  getMediaAssetUrl,
  getMediaAssetForRead,
} from "./index";

test("detectMediaMimeType recognizes supported image signatures", () => {
  expect(
    detectMediaMimeType(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  ).toBe("image/png");
  expect(detectMediaMimeType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(
    "image/jpeg",
  );
  expect(
    detectMediaMimeType(
      Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
  ).toBe("image/webp");
  expect(detectMediaMimeType(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
});

test.serial("media assets persist privately and can be deleted", async () => {
  const previousStorageRoot = process.env.MEDIA_STORAGE_ROOT;
  const storageRoot = await mkdtemp(join(tmpdir(), "openstatus-media-test-"));
  process.env.MEDIA_STORAGE_ROOT = storageRoot;

  try {
    await withTestTransaction(async (tx) => {
      const suffix = crypto.randomUUID();
      const createdUser = await tx
        .insert(user)
        .values({ email: `media-${suffix}@example.com`, name: "Media Test" })
        .returning()
        .get();
      const otherUser = await tx
        .insert(user)
        .values({
          email: `media-other-${suffix}@example.com`,
          name: "Media Other User",
        })
        .returning()
        .get();
      const createdWorkspace = await tx
        .insert(workspace)
        .values({ slug: `media-${suffix}`, name: "Media Test", plan: "team" })
        .returning()
        .get();
      await tx.insert(usersToWorkspaces).values([
        {
          userId: createdUser.id,
          workspaceId: createdWorkspace.id,
          role: "owner",
        },
        {
          userId: otherUser.id,
          workspaceId: createdWorkspace.id,
          role: "member",
        },
      ]);

      const ctx = {
        ...makeUserCtx(selectWorkspaceSchema.parse(createdWorkspace), {
          userId: createdUser.id,
        }),
        db: tx,
      };
      const otherCtx = {
        ...makeUserCtx(selectWorkspaceSchema.parse(createdWorkspace), {
          userId: otherUser.id,
        }),
        db: tx,
      };
      const bytes = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const asset = await createMediaAsset({
        ctx,
        input: {
          purpose: "claim_evidence",
          originalFilename: "evidence.png",
          declaredMimeType: "image/png",
          bytes,
        },
      });

      const storedPath = join(storageRoot, "claim_evidence", `${asset.id}.png`);
      await access(storedPath);

      const readable = await getMediaAssetForRead({ ctx, id: asset.id });
      expect(readable.asset).toEqual(asset);
      expect(Uint8Array.from(readable.bytes)).toEqual(bytes);

      await expect(
        getMediaAssetForRead({ ctx: otherCtx, id: asset.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await deleteMediaAsset({ ctx, id: asset.id });
      await expect(access(storedPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  } finally {
    if (previousStorageRoot === undefined) {
      delete process.env.MEDIA_STORAGE_ROOT;
    } else {
      process.env.MEDIA_STORAGE_ROOT = previousStorageRoot;
    }
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test.serial(
  "provider logos become durable public assets while attached",
  async () => {
    const previousStorageRoot = process.env.MEDIA_STORAGE_ROOT;
    const previousDashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL;
    const storageRoot = await mkdtemp(join(tmpdir(), "openstatus-logo-test-"));
    process.env.MEDIA_STORAGE_ROOT = storageRoot;
    process.env.NEXT_PUBLIC_DASHBOARD_URL = "https://app.example.com";

    try {
      await withTestTransaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const [owner, member] = await tx
          .insert(user)
          .values([
            { email: `logo-${suffix}@example.com`, name: "Logo Owner" },
            {
              email: `logo-member-${suffix}@example.com`,
              name: "Logo Member",
            },
          ])
          .returning()
          .all();
        const workspaceRow = await tx
          .insert(workspace)
          .values({
            slug: `logo-${suffix}`,
            name: "Logo Workspace",
            plan: "team",
          })
          .returning()
          .get();
        expect(owner).toBeDefined();
        expect(member).toBeDefined();
        if (!owner || !member) return;
        await tx.insert(usersToWorkspaces).values([
          {
            userId: owner.id,
            workspaceId: workspaceRow.id,
            role: "owner",
          },
          {
            userId: member.id,
            workspaceId: workspaceRow.id,
            role: "member",
          },
        ]);

        const ctx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(workspaceRow), {
            userId: owner.id,
          }),
          db: tx,
        };
        const memberCtx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(workspaceRow), {
            userId: member.id,
          }),
          db: tx,
        };
        const bytes = Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        const asset = await createMediaAsset({
          ctx,
          input: {
            purpose: "provider_logo",
            originalFilename: "logo.png",
            declaredMimeType: "image/png",
            bytes,
          },
        });
        const stored = await tx
          .select()
          .from(mediaAsset)
          .where(eq(mediaAsset.id, asset.id))
          .get();
        expect(stored?.visibility).toBe("public");
        expect(stored?.expiresAt).toBeInstanceOf(Date);

        const temporaryRead = await getMediaAssetForRead({
          ctx: memberCtx,
          id: asset.id,
        });
        expect(temporaryRead.cacheControl).toBe("private, no-store");

        await tx
          .update(mediaAsset)
          .set({ expiresAt: null })
          .where(eq(mediaAsset.id, asset.id));
        const publicPage = await tx
          .insert(page)
          .values({
            workspaceId: workspaceRow.id,
            title: "Logo Provider",
            description: "Logo provider status page",
            slug: `logo-provider-${suffix}`,
            customDomain: "",
            icon: getMediaAssetUrl(asset.id),
            published: true,
            accessType: "public",
          })
          .returning()
          .get();

        const durableRead = await getMediaAssetForRead({
          ctx: memberCtx,
          id: asset.id,
        });
        expect(durableRead.cacheControl).toBe(
          "public, max-age=31536000, immutable",
        );
        await expect(
          deleteMediaAsset({ ctx, id: asset.id }),
        ).rejects.toMatchObject({ code: "CONFLICT" });

        await tx
          .update(page)
          .set({ icon: "" })
          .where(eq(page.id, publicPage.id));
        await deleteMediaAsset({ ctx, id: asset.id });
        await expect(
          access(join(storageRoot, "provider_logo", `${asset.id}.png`)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      });
    } finally {
      if (previousStorageRoot === undefined) {
        delete process.env.MEDIA_STORAGE_ROOT;
      } else {
        process.env.MEDIA_STORAGE_ROOT = previousStorageRoot;
      }
      if (previousDashboardUrl === undefined) {
        delete process.env.NEXT_PUBLIC_DASHBOARD_URL;
      } else {
        process.env.NEXT_PUBLIC_DASHBOARD_URL = previousDashboardUrl;
      }
      await rm(storageRoot, { recursive: true, force: true });
    }
  },
);
