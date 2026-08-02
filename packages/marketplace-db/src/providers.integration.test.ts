import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import {
  createHubProvider,
  HubProviderLimitError,
  listHubProviders,
} from "./groups";
import { hubProviders } from "./schema";

const databaseUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("LLMHub provider repository", () => {
  if (!databaseUrl) return;
  const { client, db } = createMarketplaceDb(databaseUrl);
  const ownerWorkspaceId = "workspace-provider-test";

  beforeEach(() =>
    db
      .delete(hubProviders)
      .where(eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId)),
  );

  afterAll(async () => {
    await db
      .delete(hubProviders)
      .where(eq(hubProviders.ownerWorkspaceId, ownerWorkspaceId));
    await client.close();
  });

  test("creates providers within the account limit", async () => {
    const first = await createHubProvider(db, {
      ownerWorkspaceId,
      slugBase: ownerWorkspaceId,
      name: "Workspace Provider",
      providerLimit: 1,
    });

    expect(first.slug).toBe(ownerWorkspaceId);
    expect(await listHubProviders(db, ownerWorkspaceId)).toEqual([
      expect.objectContaining({
        id: first.id,
        displayName: "Workspace Provider",
      }),
    ]);
    let limitError: unknown;
    try {
      await createHubProvider(db, {
        ownerWorkspaceId,
        slugBase: ownerWorkspaceId,
        name: "Second Provider",
        providerLimit: 1,
      });
    } catch (error) {
      limitError = error;
    }
    expect(limitError).toBeInstanceOf(HubProviderLimitError);
  });
});
