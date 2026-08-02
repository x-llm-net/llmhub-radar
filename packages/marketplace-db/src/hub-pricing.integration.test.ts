import { beforeEach, describe, expect, test } from "bun:test";

import { and, asc, eq, isNull, like } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import {
  HubModelPriceValidationError,
  listHubModelPrices,
  replaceHubModelPrice,
} from "./hub-pricing";
import {
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
} from "./schema";
import { clearHubRoutingAndBillingTestData } from "./test-helpers";

const configuredUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const databaseUrl =
  configuredUrl &&
  /(^|[_-])test([_-]|$)/i.test(
    new URL(configuredUrl).pathname.split("/").at(-1) ?? "",
  )
    ? configuredUrl
    : undefined;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("LLMHub official model pricing repository", () => {
  if (!databaseUrl) return;
  const { db } = createMarketplaceDb(databaseUrl);

  beforeEach(async () => {
    await clearHubRoutingAndBillingTestData(db);
    const testModels = await db
      .select({ id: hubModels.id })
      .from(hubModels)
      .where(like(hubModels.slug, "pricing-test-%"));
    for (const model of testModels) {
      const versions = await db
        .select({ id: hubModelPriceVersions.id })
        .from(hubModelPriceVersions)
        .where(eq(hubModelPriceVersions.modelId, model.id));
      for (const version of versions) {
        await db
          .delete(hubModelPriceComponents)
          .where(eq(hubModelPriceComponents.priceVersionId, version.id));
      }
      await db
        .delete(hubModelPriceVersions)
        .where(eq(hubModelPriceVersions.modelId, model.id));
    }
    await db.delete(hubModels).where(like(hubModels.slug, "pricing-test-%"));
  });

  test("lists unpriced models and returns the current USD price", async () => {
    const pricedModelId = await seedModel("gpt-5.5", 10);
    const unpricedModelId = await seedModel("claude-sonnet-4.6", 20);

    await replaceHubModelPrice(db, {
      modelId: pricedModelId,
      changedByUserId: "admin-user",
      changeReason: "Initial official price",
      components: [
        { component: "input_text", amountMicros: "2500000" },
        { component: "output_text", amountMicros: "10000000" },
        { component: "cache_read", amountMicros: "250000" },
        { component: "cache_write", amountMicros: "3125000" },
      ],
    });

    const models = await listHubModelPrices(db);
    const priced = models.find((model) => model.id === pricedModelId);
    const unpriced = models.find((model) => model.id === unpricedModelId);

    expect(priced?.price).toEqual(
      expect.objectContaining({
        currency: "USD",
        billingMode: "token",
        source: "manual",
        changedByUserId: "admin-user",
        changeReason: "Initial official price",
        components: [
          {
            component: "input_text",
            unit: "million_tokens",
            unitSize: 1,
            amountMicros: "2500000",
          },
          {
            component: "output_text",
            unit: "million_tokens",
            unitSize: 1,
            amountMicros: "10000000",
          },
          {
            component: "cache_read",
            unit: "million_tokens",
            unitSize: 1,
            amountMicros: "250000",
          },
          {
            component: "cache_write",
            unit: "million_tokens",
            unitSize: 1,
            amountMicros: "3125000",
          },
        ],
      }),
    );
    expect(unpriced?.price).toBeNull();
  });

  test("closes the old version and keeps immutable price history", async () => {
    const modelId = await seedModel("gpt-5.5");
    const first = await replaceHubModelPrice(db, {
      modelId,
      changedByUserId: "admin-a",
      changeReason: "Initial price",
      components: [
        { component: "input_text", amountMicros: "1000000" },
        { component: "output_text", amountMicros: "2000000" },
      ],
    });
    const second = await replaceHubModelPrice(db, {
      modelId,
      changedByUserId: "admin-b",
      changeReason: "Official price update",
      components: [
        { component: "input_text", amountMicros: "1250000" },
        { component: "output_text", amountMicros: "2500000" },
        { component: "cache_read", amountMicros: "125000" },
      ],
    });

    const versions = await db
      .select()
      .from(hubModelPriceVersions)
      .where(eq(hubModelPriceVersions.modelId, modelId))
      .orderBy(asc(hubModelPriceVersions.effectiveFrom));
    const components = await db
      .select()
      .from(hubModelPriceComponents)
      .orderBy(asc(hubModelPriceComponents.createdAt));

    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual(
      expect.objectContaining({
        id: first.versionId,
        effectiveTo: second.effectiveFrom,
        changedByUserId: "admin-a",
        changeReason: "Initial price",
      }),
    );
    expect(versions[1]).toEqual(
      expect.objectContaining({
        id: second.versionId,
        effectiveTo: null,
        changedByUserId: "admin-b",
        changeReason: "Official price update",
      }),
    );
    expect(
      components.filter((row) => row.priceVersionId === first.versionId),
    ).toHaveLength(2);
    expect(
      components.filter((row) => row.priceVersionId === second.versionId),
    ).toHaveLength(3);
  });

  test("serializes concurrent immediate price changes per model", async () => {
    const modelId = await seedModel("gpt-5.5");

    await Promise.all([
      replaceHubModelPrice(db, {
        modelId,
        changedByUserId: "admin-a",
        changeReason: "Concurrent A",
        components: [
          { component: "input_text", amountMicros: "100" },
          { component: "output_text", amountMicros: "200" },
        ],
      }),
      replaceHubModelPrice(db, {
        modelId,
        changedByUserId: "admin-b",
        changeReason: "Concurrent B",
        components: [
          { component: "input_text", amountMicros: "200" },
          { component: "output_text", amountMicros: "400" },
        ],
      }),
    ]);

    const versions = await db
      .select()
      .from(hubModelPriceVersions)
      .where(eq(hubModelPriceVersions.modelId, modelId))
      .orderBy(asc(hubModelPriceVersions.effectiveFrom));
    expect(versions).toHaveLength(2);
    expect(
      versions.filter((version) => version.effectiveTo === null),
    ).toHaveLength(1);
    expect(versions[0]?.effectiveTo?.getTime()).toBe(
      versions[1]?.effectiveFrom.getTime(),
    );
  });

  test("rejects invalid replacement data without changing the current price", async () => {
    const modelId = await seedModel("gpt-5.5");
    const current = await replaceHubModelPrice(db, {
      modelId,
      changedByUserId: "admin-a",
      changeReason: "Initial price",
      components: [
        { component: "input_text", amountMicros: "100" },
        { component: "output_text", amountMicros: "200" },
      ],
    });

    await expect(
      replaceHubModelPrice(db, {
        modelId,
        changedByUserId: "admin-b",
        changeReason: "Invalid update",
        components: [
          { component: "input_text", amountMicros: "-1" },
          { component: "output_text", amountMicros: "200" },
        ],
      }),
    ).rejects.toBeInstanceOf(HubModelPriceValidationError);

    const [version] = await db
      .select()
      .from(hubModelPriceVersions)
      .where(
        and(
          eq(hubModelPriceVersions.modelId, modelId),
          isNull(hubModelPriceVersions.effectiveTo),
        ),
      );
    expect(version?.id).toBe(current.versionId);
    expect(
      await db
        .select()
        .from(hubModelPriceVersions)
        .where(eq(hubModelPriceVersions.modelId, modelId)),
    ).toHaveLength(1);
  });

  test("requires both input and output prices", async () => {
    const modelId = await seedModel("gpt-5.5");
    await expect(
      replaceHubModelPrice(db, {
        modelId,
        changedByUserId: "admin-a",
        changeReason: "Incomplete price",
        components: [{ component: "input_text", amountMicros: "100" }],
      }),
    ).rejects.toThrow("output_text price component is required");
  });

  async function seedModel(canonicalName: string, sortOrder = 0) {
    const slug = `pricing-test-${canonicalName.replaceAll(".", "-")}`;
    const testCanonicalName = `pricing-test-${canonicalName}`;
    const [model] = await db
      .insert(hubModels)
      .values({
        slug,
        vendor: canonicalName.startsWith("gpt") ? "OpenAI" : "Anthropic",
        family: canonicalName.startsWith("gpt") ? "GPT" : "Claude",
        canonicalName: testCanonicalName,
        displayName: canonicalName,
        shortName: canonicalName,
        sortOrder,
      })
      .returning({ id: hubModels.id });
    if (!model) throw new Error("Unable to seed model");
    return model.id;
  }
});
