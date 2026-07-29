import { expect, test } from "bun:test";

import { eq } from "@openstatus/db";
import {
  mediaAsset,
  page,
  radarPool,
  radarProvider,
  selectWorkspaceSchema,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { makeUserCtx, withTestTransaction } from "../../test/helpers";
import { getMediaAssetUrl } from "../media/index";
import { updateRadarPool } from "./create";
import { getRadarPool } from "./list";

test.serial(
  "provider logo replacement and removal update the public page",
  async () => {
    const previousDashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL;
    process.env.NEXT_PUBLIC_DASHBOARD_URL = "https://app.example.com";

    try {
      await withTestTransaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const owner = await tx
          .insert(user)
          .values({
            email: `radar-logo-${suffix}@example.com`,
            name: "Logo Owner",
          })
          .returning()
          .get();
        const workspaceRow = await tx
          .insert(workspace)
          .values({
            slug: `radar-logo-${suffix}`,
            name: "Logo Workspace",
            plan: "team",
          })
          .returning()
          .get();
        await tx.insert(usersToWorkspaces).values({
          userId: owner.id,
          workspaceId: workspaceRow.id,
          role: "owner",
        });

        const [oldLogo, newLogo] = await tx
          .insert(mediaAsset)
          .values([
            {
              id: crypto.randomUUID(),
              workspaceId: workspaceRow.id,
              ownerUserId: owner.id,
              purpose: "provider_logo",
              visibility: "public",
              storageKey: `provider_logo/${crypto.randomUUID()}.png`,
              originalFilename: "old-logo.png",
              mimeType: "image/png",
              sizeBytes: 8,
              expiresAt: null,
            },
            {
              id: crypto.randomUUID(),
              workspaceId: workspaceRow.id,
              ownerUserId: owner.id,
              purpose: "provider_logo",
              visibility: "public",
              storageKey: `provider_logo/${crypto.randomUUID()}.png`,
              originalFilename: "new-logo.png",
              mimeType: "image/png",
              sizeBytes: 8,
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
          ])
          .returning()
          .all();
        expect(oldLogo).toBeDefined();
        expect(newLogo).toBeDefined();
        if (!oldLogo || !newLogo) return;

        const publicPage = await tx
          .insert(page)
          .values({
            workspaceId: workspaceRow.id,
            title: "Logo Provider",
            description: "Provider logo test",
            slug: `logo-provider-${suffix}`,
            customDomain: "",
            icon: getMediaAssetUrl(oldLogo.id),
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
            name: "Logo Provider",
            slug: publicPage.slug,
            visibility: "unlisted",
            pageId: publicPage.id,
          })
          .returning()
          .get();
        await tx.insert(radarProvider).values({
          workspaceId: workspaceRow.id,
          poolId: pool.id,
          name: pool.name,
          displayName: pool.name,
          baseUrlEncrypted: "encrypted-base-url",
          baseUrlHostHash: `logo-host-${suffix}`,
        });

        const ctx = {
          ...makeUserCtx(selectWorkspaceSchema.parse(workspaceRow), {
            userId: owner.id,
          }),
          db: tx,
        };
        await updateRadarPool({
          ctx,
          input: {
            currentSlug: pool.slug,
            name: pool.name,
            slug: pool.slug,
            description: "Provider logo test",
            baseUrl: "https://api.example.com/v1",
            logoAssetId: newLogo.id,
            publicPoolOptIn: false,
          },
        });

        const [updatedPage, durableNewLogo, releasedOldLogo, detail] =
          await Promise.all([
            tx.select().from(page).where(eq(page.id, publicPage.id)).get(),
            tx
              .select()
              .from(mediaAsset)
              .where(eq(mediaAsset.id, newLogo.id))
              .get(),
            tx
              .select()
              .from(mediaAsset)
              .where(eq(mediaAsset.id, oldLogo.id))
              .get(),
            getRadarPool({ ctx, input: { slug: pool.slug } }),
          ]);
        expect(updatedPage?.icon).toBe(getMediaAssetUrl(newLogo.id));
        expect(detail.logoUrl).toBe(getMediaAssetUrl(newLogo.id));
        expect(durableNewLogo?.expiresAt).toBeNull();
        expect(releasedOldLogo?.expiresAt).toBeInstanceOf(Date);

        await updateRadarPool({
          ctx,
          input: {
            currentSlug: pool.slug,
            name: pool.name,
            slug: pool.slug,
            description: "Provider logo test",
            baseUrl: "https://api.example.com/v1",
            logoAssetId: null,
            publicPoolOptIn: false,
          },
        });
        const [pageWithoutLogo, releasedNewLogo] = await Promise.all([
          tx.select().from(page).where(eq(page.id, publicPage.id)).get(),
          tx
            .select()
            .from(mediaAsset)
            .where(eq(mediaAsset.id, newLogo.id))
            .get(),
        ]);
        expect(pageWithoutLogo?.icon).toBe("");
        expect(releasedNewLogo?.expiresAt).toBeInstanceOf(Date);
      });
    } finally {
      if (previousDashboardUrl === undefined) {
        delete process.env.NEXT_PUBLIC_DASHBOARD_URL;
      } else {
        process.env.NEXT_PUBLIC_DASHBOARD_URL = previousDashboardUrl;
      }
    }
  },
);
