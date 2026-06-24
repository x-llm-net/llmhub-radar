import { and, eq } from "@openstatus/db";
import {
  page,
  radarCredential,
  radarPool,
  radarProbeTarget,
  radarProvider,
  radarTargetStatus,
  selectRadarCredentialSchema,
  selectRadarPoolSchema,
  selectRadarProbeTargetSchema,
  selectRadarProviderSchema,
} from "@openstatus/db/src/schema";

import { requireScope } from "../auth";
import { type ServiceContext, withTransaction } from "../context";
import {
  ConflictError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "../errors";
import { getBaseUrlHostHash, normalizeRadarBaseUrl } from "./base-url";
import { encryptSecret, getSecretLastFour, hashSecret } from "./crypto";
import {
  AddRadarTokenProbeInput,
  CreateRadarCredentialInput,
  CreateRadarPoolInput,
  CreateRadarProviderInput,
  CreateRadarTargetInput,
  DeleteRadarCredentialInput,
  UpdateRadarTokenProbeInput,
} from "./schemas";

const DEFAULT_POOL_LIMIT = 5;

function toTargetName(providerName: string, targetName: string): string {
  return `${providerName} / ${targetName}`;
}

function normalizeModelCatalog(models: string[], probeModel?: string | null) {
  const normalized = Array.from(
    new Set(
      [probeModel, ...models].filter((model): model is string =>
        Boolean(model),
      ),
    ),
  );
  return normalized.slice(0, 200);
}

function getDefaultTargetDisplayName(input: {
  targetName?: string;
  credential: NonNullable<CreateRadarPoolInput["credential"]>;
}) {
  return (
    input.targetName ||
    input.credential.modelGroup ||
    input.credential.billingGroup ||
    input.credential.name ||
    "Default group"
  );
}

function safeProvider(row: typeof radarProvider.$inferSelect) {
  const { baseUrlEncrypted: _baseUrlEncrypted, ...safe } =
    selectRadarProviderSchema.parse(row);
  return safe;
}

function safeCredential(row: typeof radarCredential.$inferSelect) {
  const { encryptedApiKey: _encryptedApiKey, ...safe } =
    selectRadarCredentialSchema.parse(row);
  return safe;
}

export async function createRadarPool(args: {
  ctx: ServiceContext;
  input: CreateRadarPoolInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = CreateRadarPoolInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const [existingSlug, existingPageSlug, countRow] = await Promise.all([
      tx
        .select({ id: radarPool.id })
        .from(radarPool)
        .where(
          and(
            eq(radarPool.workspaceId, ctx.workspace.id),
            eq(radarPool.slug, input.slug),
          ),
        )
        .get(),
      tx
        .select({ id: page.id })
        .from(page)
        .where(eq(page.slug, input.slug))
        .get(),
      tx
        .select({ count: radarPool.id })
        .from(radarPool)
        .where(eq(radarPool.workspaceId, ctx.workspace.id))
        .all(),
    ]);

    if (existingSlug) {
      throw new ConflictError("Radar status page slug already exists.");
    }
    if (existingPageSlug)
      throw new ConflictError("Status page slug already exists.");
    if (countRow.length >= DEFAULT_POOL_LIMIT) {
      throw new LimitExceededError("radar status pages", DEFAULT_POOL_LIMIT);
    }
    const publicPage = await tx
      .insert(page)
      .values({
        workspaceId: ctx.workspace.id,
        title: input.name,
        description:
          input.description || "Model availability and first-token latency.",
        slug: input.slug,
        customDomain: "",
        published: true,
        accessType: "public",
        defaultLocale: "zh",
        updatedAt: new Date(),
      })
      .returning()
      .get();

    const pool = await tx
      .insert(radarPool)
      .values({
        workspaceId: ctx.workspace.id,
        name: input.name,
        slug: input.slug,
        description: input.description,
        visibility: input.visibility,
        publicPoolOptIn: input.publicPoolOptIn,
        pageId: publicPage.id,
        updatedAt: new Date(),
      })
      .returning()
      .get();

    if (!input.provider) {
      return selectRadarPoolSchema.parse(pool);
    }

    const baseUrl = normalizeRadarBaseUrl(input.provider.baseUrl);
    const providerName = input.provider.name || input.provider.displayName;
    const encryptedBaseUrl = await encryptSecret(baseUrl);

    const provider = await tx
      .insert(radarProvider)
      .values({
        workspaceId: ctx.workspace.id,
        poolId: pool.id,
        name: providerName,
        displayName: input.provider.displayName,
        baseUrlEncrypted: encryptedBaseUrl,
        baseUrlHostHash: await getBaseUrlHostHash(baseUrl),
        baseUrlVisibility: input.provider.baseUrlVisibility,
        providerType: input.provider.providerType,
        updatedAt: new Date(),
      })
      .returning()
      .get();

    if (!input.credential) {
      return selectRadarPoolSchema.parse(pool);
    }

    const probeModel = input.probeModel || input.models[0];
    const encryptedApiKey = await encryptSecret(input.credential.apiKey);
    const credential = await tx
      .insert(radarCredential)
      .values({
        workspaceId: ctx.workspace.id,
        providerId: provider.id,
        name: input.credential.name,
        encryptedApiKey,
        keyFingerprint: await hashSecret(input.credential.apiKey),
        lastFour: getSecretLastFour(input.credential.apiKey),
        billingGroup: input.credential.billingGroup,
        modelGroup: input.credential.modelGroup,
        modelCatalog: normalizeModelCatalog(
          [...input.credential.modelCatalog, ...input.models],
          probeModel,
        ),
        updatedAt: new Date(),
      })
      .returning()
      .get();

    if (probeModel) {
      const targetDisplayName = getDefaultTargetDisplayName({
        targetName: input.targetName,
        credential: input.credential,
      });
      const target = await tx
        .insert(radarProbeTarget)
        .values({
          workspaceId: ctx.workspace.id,
          poolId: pool.id,
          providerId: provider.id,
          credentialId: credential.id,
          name: toTargetName(input.provider.displayName, targetDisplayName),
          displayName: targetDisplayName,
          modelName: probeModel,
          nextCheckAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
        .get();

      await tx.insert(radarTargetStatus).values({
        workspaceId: ctx.workspace.id,
        targetId: target.id,
        currentStatus: "unknown",
        updatedAt: new Date(),
      });
    }

    return selectRadarPoolSchema.parse(pool);
  });
}

export async function createRadarProvider(args: {
  ctx: ServiceContext;
  input: CreateRadarProviderInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = CreateRadarProviderInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const pool = await tx
      .select({ id: radarPool.id })
      .from(radarPool)
      .where(
        and(
          eq(radarPool.id, input.poolId),
          eq(radarPool.workspaceId, ctx.workspace.id),
        ),
      )
      .get();
    if (!pool) throw new NotFoundError("radar_pool", input.poolId);

    const existingProvider = await tx
      .select({ id: radarProvider.id })
      .from(radarProvider)
      .where(eq(radarProvider.poolId, input.poolId))
      .get();
    if (existingProvider) {
      throw new ConflictError("Radar status pages can only have one provider.");
    }

    const baseUrl = normalizeRadarBaseUrl(input.baseUrl);
    const row = await tx
      .insert(radarProvider)
      .values({
        workspaceId: ctx.workspace.id,
        poolId: input.poolId,
        name: input.name || input.displayName,
        displayName: input.displayName,
        baseUrlEncrypted: await encryptSecret(baseUrl),
        baseUrlHostHash: await getBaseUrlHostHash(baseUrl),
        baseUrlVisibility: input.baseUrlVisibility,
        providerType: input.providerType,
        enabled: input.enabled,
        notes: input.notes,
        updatedAt: new Date(),
      })
      .returning()
      .get();

    return safeProvider(row);
  });
}

export async function createRadarCredential(args: {
  ctx: ServiceContext;
  input: CreateRadarCredentialInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = CreateRadarCredentialInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const provider = await tx
      .select({ id: radarProvider.id })
      .from(radarProvider)
      .where(
        and(
          eq(radarProvider.id, input.providerId),
          eq(radarProvider.workspaceId, ctx.workspace.id),
        ),
      )
      .get();
    if (!provider) throw new NotFoundError("radar_provider", input.providerId);

    const keyFingerprint = await hashSecret(input.apiKey);
    const existing = await tx
      .select({ id: radarCredential.id })
      .from(radarCredential)
      .where(
        and(
          eq(radarCredential.providerId, input.providerId),
          eq(radarCredential.keyFingerprint, keyFingerprint),
        ),
      )
      .get();
    if (existing) {
      throw new ConflictError("Radar credential already exists for provider.");
    }

    const row = await tx
      .insert(radarCredential)
      .values({
        workspaceId: ctx.workspace.id,
        providerId: input.providerId,
        name: input.name,
        description: input.description,
        encryptedApiKey: await encryptSecret(input.apiKey),
        keyFingerprint,
        lastFour: getSecretLastFour(input.apiKey),
        billingGroup: input.billingGroup,
        modelGroup: input.modelGroup,
        modelCatalog: normalizeModelCatalog(input.modelCatalog),
        dailyProbeLimit: input.dailyProbeLimit,
        dailyTokenLimit: input.dailyTokenLimit,
        dailyCostLimitCents: input.dailyCostLimitCents,
        enabled: input.enabled,
        updatedAt: new Date(),
      })
      .returning()
      .get();

    return safeCredential(row);
  });
}

export async function addRadarTokenProbe(args: {
  ctx: ServiceContext;
  input: AddRadarTokenProbeInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = AddRadarTokenProbeInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const pool = await tx
      .select({ id: radarPool.id })
      .from(radarPool)
      .where(
        and(
          eq(radarPool.slug, input.poolSlug),
          eq(radarPool.workspaceId, ctx.workspace.id),
        ),
      )
      .get();

    if (!pool) throw new NotFoundError("radar_pool", input.poolSlug);

    const providers = await tx
      .select()
      .from(radarProvider)
      .where(eq(radarProvider.poolId, pool.id))
      .all();

    if (providers.length === 0) {
      throw new NotFoundError("radar_provider", input.poolSlug);
    }
    if (providers.length > 1) {
      throw new ValidationError(
        "Radar status pages must have exactly one provider.",
      );
    }
    const provider = providers[0];
    if (!provider) throw new NotFoundError("radar_provider", input.poolSlug);

    const keyFingerprint = await hashSecret(input.apiKey);
    const existing = await tx
      .select({ id: radarCredential.id })
      .from(radarCredential)
      .where(
        and(
          eq(radarCredential.providerId, provider.id),
          eq(radarCredential.keyFingerprint, keyFingerprint),
        ),
      )
      .get();
    if (existing) {
      throw new ConflictError("Radar credential already exists for provider.");
    }

    const now = new Date();
    const credential = await tx
      .insert(radarCredential)
      .values({
        workspaceId: ctx.workspace.id,
        providerId: provider.id,
        name: input.apiKeyName,
        encryptedApiKey: await encryptSecret(input.apiKey),
        keyFingerprint,
        lastFour: getSecretLastFour(input.apiKey),
        billingGroup: input.apiKeyName,
        modelGroup: input.modelType,
        modelCatalog: normalizeModelCatalog(
          input.availableModels,
          input.probeModel,
        ),
        updatedAt: now,
      })
      .returning()
      .get();

    const target = await tx
      .insert(radarProbeTarget)
      .values({
        workspaceId: ctx.workspace.id,
        poolId: pool.id,
        providerId: provider.id,
        credentialId: credential.id,
        name: `${provider.displayName} / ${input.modelType} / ${input.apiKeyName}`,
        displayName: input.apiKeyName,
        modelName: input.probeModel,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        streamEnabled: input.streamEnabled,
        nextCheckAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    await tx.insert(radarTargetStatus).values({
      workspaceId: ctx.workspace.id,
      targetId: target.id,
      currentStatus: "unknown",
      updatedAt: now,
    });

    return selectRadarProbeTargetSchema.parse(target);
  });
}

export async function updateRadarTokenProbe(args: {
  ctx: ServiceContext;
  input: UpdateRadarTokenProbeInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = UpdateRadarTokenProbeInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const row = await tx
      .select({
        pool: radarPool,
        provider: radarProvider,
        credential: radarCredential,
      })
      .from(radarCredential)
      .innerJoin(
        radarProvider,
        eq(radarCredential.providerId, radarProvider.id),
      )
      .innerJoin(radarPool, eq(radarProvider.poolId, radarPool.id))
      .where(
        and(
          eq(radarPool.slug, input.poolSlug),
          eq(radarPool.workspaceId, ctx.workspace.id),
          eq(radarCredential.id, input.credentialId),
        ),
      )
      .get();

    if (!row) {
      throw new NotFoundError("radar_credential", input.credentialId);
    }

    const now = new Date();
    const modelCatalog = normalizeModelCatalog(
      input.availableModels,
      input.probeModel,
    );
    const credentialUpdate: Partial<typeof radarCredential.$inferInsert> = {
      name: input.apiKeyName,
      billingGroup: input.apiKeyName,
      modelGroup: input.modelType,
      modelCatalog,
      updatedAt: now,
    };

    if (input.apiKey) {
      const keyFingerprint = await hashSecret(input.apiKey);
      if (keyFingerprint !== row.credential.keyFingerprint) {
        const existing = await tx
          .select({ id: radarCredential.id })
          .from(radarCredential)
          .where(
            and(
              eq(radarCredential.providerId, row.provider.id),
              eq(radarCredential.keyFingerprint, keyFingerprint),
            ),
          )
          .get();

        if (existing && existing.id !== row.credential.id) {
          throw new ConflictError(
            "Radar credential already exists for provider.",
          );
        }
      }

      credentialUpdate.encryptedApiKey = await encryptSecret(input.apiKey);
      credentialUpdate.keyFingerprint = keyFingerprint;
      credentialUpdate.lastFour = getSecretLastFour(input.apiKey);
    }

    const credential = await tx
      .update(radarCredential)
      .set(credentialUpdate)
      .where(eq(radarCredential.id, row.credential.id))
      .returning()
      .get();

    const target = await tx
      .select()
      .from(radarProbeTarget)
      .where(
        and(
          eq(radarProbeTarget.poolId, row.pool.id),
          eq(radarProbeTarget.credentialId, row.credential.id),
        ),
      )
      .get();

    if (target) {
      await tx
        .update(radarProbeTarget)
        .set({
          name: `${row.provider.displayName} / ${input.modelType} / ${input.apiKeyName}`,
          displayName: input.apiKeyName,
          modelName: input.probeModel,
          nextCheckAt: now,
          updatedAt: now,
        })
        .where(eq(radarProbeTarget.id, target.id));
    } else {
      const createdTarget = await tx
        .insert(radarProbeTarget)
        .values({
          workspaceId: ctx.workspace.id,
          poolId: row.pool.id,
          providerId: row.provider.id,
          credentialId: row.credential.id,
          name: `${row.provider.displayName} / ${input.modelType} / ${input.apiKeyName}`,
          displayName: input.apiKeyName,
          modelName: input.probeModel,
          nextCheckAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      await tx.insert(radarTargetStatus).values({
        workspaceId: ctx.workspace.id,
        targetId: createdTarget.id,
        currentStatus: "unknown",
        updatedAt: now,
      });
    }

    return safeCredential(credential);
  });
}

export async function deleteRadarCredential(args: {
  ctx: ServiceContext;
  input: DeleteRadarCredentialInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = DeleteRadarCredentialInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const row = await tx
      .select({
        pool: radarPool,
        credential: radarCredential,
      })
      .from(radarCredential)
      .innerJoin(
        radarProvider,
        eq(radarCredential.providerId, radarProvider.id),
      )
      .innerJoin(radarPool, eq(radarProvider.poolId, radarPool.id))
      .where(
        and(
          eq(radarPool.slug, input.poolSlug),
          eq(radarPool.workspaceId, ctx.workspace.id),
          eq(radarCredential.id, input.credentialId),
        ),
      )
      .get();

    if (!row) {
      throw new NotFoundError("radar_credential", input.credentialId);
    }

    await tx
      .delete(radarProbeTarget)
      .where(
        and(
          eq(radarProbeTarget.poolId, row.pool.id),
          eq(radarProbeTarget.credentialId, row.credential.id),
        ),
      );
    await tx
      .delete(radarCredential)
      .where(eq(radarCredential.id, row.credential.id));

    return { id: input.credentialId };
  });
}

export async function createRadarTarget(args: {
  ctx: ServiceContext;
  input: CreateRadarTargetInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = CreateRadarTargetInput.parse(args.input);

  return withTransaction(ctx, async (tx) => {
    const provider = await tx
      .select()
      .from(radarProvider)
      .where(
        and(
          eq(radarProvider.id, input.providerId),
          eq(radarProvider.workspaceId, ctx.workspace.id),
        ),
      )
      .get();
    if (!provider) throw new NotFoundError("radar_provider", input.providerId);
    if (provider.poolId !== input.poolId) {
      throw new ValidationError("Provider does not belong to the pool.");
    }

    const pool = await tx
      .select({ id: radarPool.id })
      .from(radarPool)
      .where(
        and(
          eq(radarPool.id, input.poolId),
          eq(radarPool.workspaceId, ctx.workspace.id),
        ),
      )
      .get();
    if (!pool) throw new NotFoundError("radar_pool", input.poolId);

    if (input.credentialId) {
      const credential = await tx
        .select({ id: radarCredential.id })
        .from(radarCredential)
        .where(
          and(
            eq(radarCredential.id, input.credentialId),
            eq(radarCredential.providerId, input.providerId),
            eq(radarCredential.workspaceId, ctx.workspace.id),
          ),
        )
        .get();
      if (!credential) {
        throw new NotFoundError("radar_credential", input.credentialId);
      }
    }

    const name =
      input.name || toTargetName(provider.displayName, input.modelName);
    const displayName = input.displayName || input.modelName;
    const target = await tx
      .insert(radarProbeTarget)
      .values({
        workspaceId: ctx.workspace.id,
        poolId: input.poolId,
        providerId: input.providerId,
        credentialId: input.credentialId,
        name,
        displayName,
        modelName: input.modelName,
        endpointType: input.endpointType,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        streamEnabled: input.streamEnabled,
        enabled: input.enabled,
        nextCheckAt: input.enabled ? new Date() : null,
        statusPolicy: input.statusPolicy,
        updatedAt: new Date(),
      })
      .returning()
      .get();

    await tx.insert(radarTargetStatus).values({
      workspaceId: ctx.workspace.id,
      targetId: target.id,
      currentStatus: "unknown",
      updatedAt: new Date(),
    });

    return selectRadarProbeTargetSchema.parse(target);
  });
}
