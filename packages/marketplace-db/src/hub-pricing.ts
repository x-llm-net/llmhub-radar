import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
} from "./schema";

export const HUB_MODEL_PRICE_COMPONENTS = [
  "input_text",
  "output_text",
  "cache_read",
  "cache_write",
] as const;

export type HubModelPriceComponentKind =
  (typeof HUB_MODEL_PRICE_COMPONENTS)[number];

export interface HubModelPriceInputComponent {
  component: HubModelPriceComponentKind;
  amountMicros: string;
}

export interface ReplaceHubModelPriceInput {
  modelId: string;
  components: HubModelPriceInputComponent[];
  changedByUserId: string;
  changeReason: string;
}

export class HubModelNotFoundError extends Error {
  constructor() {
    super("Model not found");
    this.name = "HubModelNotFoundError";
  }
}

export class HubModelPriceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubModelPriceValidationError";
  }
}

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const supportedComponents = new Set<string>(HUB_MODEL_PRICE_COMPONENTS);

export async function listHubModelPrices(
  db: MarketplaceDb,
  options: { asOf?: Date } = {},
) {
  const asOf = options.asOf ?? new Date();
  const rows = await db
    .select({
      id: hubModels.id,
      slug: hubModels.slug,
      vendor: hubModels.vendor,
      family: hubModels.family,
      canonicalName: hubModels.canonicalName,
      displayName: hubModels.displayName,
      shortName: hubModels.shortName,
      status: hubModels.status,
      sortOrder: hubModels.sortOrder,
      versionId: hubModelPriceVersions.id,
      billingMode: hubModelPriceVersions.billingMode,
      effectiveFrom: hubModelPriceVersions.effectiveFrom,
      source: hubModelPriceVersions.source,
      sourceVersion: hubModelPriceVersions.sourceVersion,
      changedByUserId: hubModelPriceVersions.changedByUserId,
      changeReason: hubModelPriceVersions.changeReason,
      component: hubModelPriceComponents.component,
      unit: hubModelPriceComponents.unit,
      unitSize: hubModelPriceComponents.unitSize,
      amountMicros: hubModelPriceComponents.amountMicros,
    })
    .from(hubModels)
    .leftJoin(
      hubModelPriceVersions,
      and(
        eq(hubModelPriceVersions.modelId, hubModels.id),
        eq(hubModelPriceVersions.currency, "USD"),
        eq(hubModelPriceVersions.billingMode, "token"),
        lte(hubModelPriceVersions.effectiveFrom, asOf),
        or(
          isNull(hubModelPriceVersions.effectiveTo),
          gt(hubModelPriceVersions.effectiveTo, asOf),
        ),
      ),
    )
    .leftJoin(
      hubModelPriceComponents,
      and(
        eq(hubModelPriceComponents.priceVersionId, hubModelPriceVersions.id),
        inArray(hubModelPriceComponents.component, HUB_MODEL_PRICE_COMPONENTS),
        eq(hubModelPriceComponents.unit, "million_tokens"),
      ),
    )
    .orderBy(
      asc(hubModels.vendor),
      asc(hubModels.sortOrder),
      asc(hubModels.displayName),
    );

  const models = new Map<
    string,
    {
      id: string;
      slug: string;
      vendor: string;
      family: string;
      canonicalName: string;
      displayName: string;
      shortName: string;
      status: (typeof rows)[number]["status"];
      sortOrder: number;
      price: null | {
        versionId: string;
        currency: "USD";
        billingMode: NonNullable<(typeof rows)[number]["billingMode"]>;
        effectiveFrom: Date;
        source: string;
        sourceVersion: string | null;
        changedByUserId: string | null;
        changeReason: string;
        components: Array<{
          component: HubModelPriceComponentKind;
          unit: "million_tokens";
          unitSize: number;
          amountMicros: string;
        }>;
      };
    }
  >();

  for (const row of rows) {
    let model = models.get(row.id);
    if (!model) {
      model = {
        id: row.id,
        slug: row.slug,
        vendor: row.vendor,
        family: row.family,
        canonicalName: row.canonicalName,
        displayName: row.displayName,
        shortName: row.shortName,
        status: row.status,
        sortOrder: row.sortOrder,
        price:
          row.versionId &&
          row.billingMode &&
          row.effectiveFrom &&
          row.source !== null &&
          row.changeReason !== null
            ? {
                versionId: row.versionId,
                currency: "USD",
                billingMode: row.billingMode,
                effectiveFrom: row.effectiveFrom,
                source: row.source,
                sourceVersion: row.sourceVersion,
                changedByUserId: row.changedByUserId,
                changeReason: row.changeReason,
                components: [],
              }
            : null,
      };
      models.set(row.id, model);
    }

    if (
      model.price &&
      row.component &&
      supportedComponents.has(row.component) &&
      row.unit === "million_tokens" &&
      row.unitSize !== null &&
      row.amountMicros !== null
    ) {
      model.price.components.push({
        component: row.component as HubModelPriceComponentKind,
        unit: "million_tokens",
        unitSize: row.unitSize,
        amountMicros: row.amountMicros.toString(),
      });
    }
  }

  for (const model of models.values()) {
    model.price?.components.sort(
      (left, right) =>
        HUB_MODEL_PRICE_COMPONENTS.indexOf(left.component) -
        HUB_MODEL_PRICE_COMPONENTS.indexOf(right.component),
    );
  }

  return [...models.values()];
}

export async function replaceHubModelPrice(
  db: MarketplaceDb,
  input: ReplaceHubModelPriceInput,
) {
  const components = validatePriceInput(input);

  return db.transaction(async (tx) => {
    const [model] = await tx
      .select({ id: hubModels.id })
      .from(hubModels)
      .where(eq(hubModels.id, input.modelId))
      .limit(1)
      .for("update");
    if (!model) throw new HubModelNotFoundError();

    const [current] = await tx
      .select({
        id: hubModelPriceVersions.id,
        effectiveFrom: hubModelPriceVersions.effectiveFrom,
      })
      .from(hubModelPriceVersions)
      .where(
        and(
          eq(hubModelPriceVersions.modelId, input.modelId),
          eq(hubModelPriceVersions.currency, "USD"),
          isNull(hubModelPriceVersions.effectiveTo),
        ),
      )
      .orderBy(desc(hubModelPriceVersions.effectiveFrom))
      .limit(1)
      .for("update");

    const wallClock = new Date();
    const effectiveAt =
      current && wallClock.getTime() <= current.effectiveFrom.getTime()
        ? new Date(current.effectiveFrom.getTime() + 1)
        : wallClock;

    if (current) {
      await tx
        .update(hubModelPriceVersions)
        .set({ effectiveTo: effectiveAt, updatedAt: effectiveAt })
        .where(
          and(
            eq(hubModelPriceVersions.id, current.id),
            isNull(hubModelPriceVersions.effectiveTo),
          ),
        );
    }

    const [version] = await tx
      .insert(hubModelPriceVersions)
      .values({
        modelId: input.modelId,
        currency: "USD",
        billingMode: "token",
        effectiveFrom: effectiveAt,
        source: "manual",
        changedByUserId: input.changedByUserId.trim(),
        changeReason: input.changeReason.trim(),
      })
      .returning({ id: hubModelPriceVersions.id });
    if (!version) throw new Error("Failed to create model price version");

    await tx.insert(hubModelPriceComponents).values(
      components.map((component) => ({
        priceVersionId: version.id,
        component: component.component,
        unit: "million_tokens" as const,
        unitSize: 1,
        amountMicros: component.amountMicros,
      })),
    );

    return {
      modelId: input.modelId,
      versionId: version.id,
      effectiveFrom: effectiveAt,
    };
  });
}

function validatePriceInput(input: ReplaceHubModelPriceInput) {
  if (!input.changedByUserId.trim()) {
    throw new HubModelPriceValidationError("changedByUserId is required");
  }
  if (!input.changeReason.trim()) {
    throw new HubModelPriceValidationError("changeReason is required");
  }
  if (input.components.length === 0) {
    throw new HubModelPriceValidationError(
      "At least one component is required",
    );
  }

  const seen = new Set<HubModelPriceComponentKind>();
  const components = input.components.map((component) => {
    if (!supportedComponents.has(component.component)) {
      throw new HubModelPriceValidationError(
        `Unsupported price component: ${component.component}`,
      );
    }
    if (seen.has(component.component)) {
      throw new HubModelPriceValidationError(
        `Duplicate price component: ${component.component}`,
      );
    }
    seen.add(component.component);
    if (!/^(0|[1-9]\d*)$/.test(component.amountMicros)) {
      throw new HubModelPriceValidationError(
        `Invalid amountMicros for ${component.component}`,
      );
    }
    const amountMicros = BigInt(component.amountMicros);
    if (amountMicros > MAX_POSTGRES_BIGINT) {
      throw new HubModelPriceValidationError(
        `amountMicros is too large for ${component.component}`,
      );
    }
    return { component: component.component, amountMicros };
  });
  for (const required of ["input_text", "output_text"] as const) {
    if (!seen.has(required)) {
      throw new HubModelPriceValidationError(
        `${required} price component is required`,
      );
    }
  }
  return components;
}
