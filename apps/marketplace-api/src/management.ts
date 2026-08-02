import { timingSafeEqual } from "node:crypto";

import {
  createHubGroup,
  createHubProvider,
  createHubApiToken,
  getHubGroup,
  getHubGroupEncryptedConfig,
  getHubLedgerBalance,
  HubGroupNotFoundError,
  HubGroupStateError,
  HubProviderConflictError,
  HubProviderLimitError,
  HubProviderNotFoundError,
  HubApiTokenNotFoundError,
  HubApiTokenRevokedError,
  HubRoutingError,
  HubModelNotFoundError,
  HubModelPriceValidationError,
  listHubCatalogModels,
  listHubApiTokens,
  listHubAvailableGroups,
  listHubTokenGroupPreferences,
  listHubUserRequestActivity,
  listHubGroupProbeRuns,
  listHubGroups,
  listHubProviders,
  listHubListingReviews,
  listHubMarketModels,
  listHubModelPrices,
  mapHubGroupModel,
  requestHubGroupListing,
  reviewHubGroupListing,
  replaceHubModelPrice,
  replaceHubTokenGroupPreferences,
  postHubManualCredit,
  revokeHubApiToken,
  scheduleHubGroupProbeNow,
  setHubGroupModelBaseUrlOverride,
  setHubGroupState,
  updateHubGroup,
  withdrawHubGroupListing,
  type MarketplaceDb,
} from "@llmhub/marketplace-db";
import {
  discoverOpenAiCompatibleModels,
  decryptSecret,
  encryptSecret,
  getBaseUrlHostHash,
  getSecretLastFour,
  hashPrivateIdentifier,
  normalizeRadarBaseUrl,
} from "@openstatus/services/radar/runtime";
import { Hono, type Context } from "hono";
import { z } from "zod";

const DEV_MANAGEMENT_TOKEN = "llmhub-marketplace-local-management";

const workspaceSchema = z.object({
  id: z.string().min(1).max(128),
  slug: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
});

const createGroupSchema = z.object({
  workspace: workspaceSchema,
  providerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1).max(4096),
  multiplierBps: z.number().int().min(0).max(1_000_000),
});

const createProviderSchema = z.object({
  workspace: workspaceSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).default(""),
  websiteUrl: z.string().trim().url().nullable().optional(),
  providerLimit: z.number().int().min(1).max(3),
});

const updateGroupSchema = z.object({
  workspace: workspaceSchema,
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  multiplierBps: z.number().int().min(0).max(1_000_000).optional(),
  rediscover: z.boolean().default(false),
});

const workspaceRequestSchema = z.object({ workspace: workspaceSchema });
const stateSchema = workspaceRequestSchema.extend({
  action: z.enum(["pause", "resume", "retire"]),
});
const mapModelSchema = workspaceRequestSchema.extend({
  modelId: z.string().uuid().nullable(),
  trafficEnabled: z.boolean().optional(),
  probeEnabled: z.boolean().optional(),
});
const modelConfigSchema = workspaceRequestSchema.extend({
  baseUrlOverride: z.string().trim().url().nullable(),
});
const listingReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewer: z.string().trim().min(1).max(128),
  note: z.string().trim().max(500).optional(),
});
const modelPriceSchema = z.object({
  components: z
    .array(
      z.object({
        component: z.enum([
          "input_text",
          "output_text",
          "cache_read",
          "cache_write",
        ]),
        amountMicros: z.string().regex(/^(0|[1-9]\d*)$/),
      }),
    )
    .min(1),
  changedByUserId: z.string().trim().min(1).max(128),
  changeReason: z.string().trim().min(1).max(500),
});

const tokenOwnerSchema = z.object({
  ownerUserId: z.string().trim().min(1).max(128),
});
const createTokenSchema = tokenOwnerSchema.extend({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime().nullable().optional(),
});
const tokenPreferencesSchema = tokenOwnerSchema.extend({
  preferences: z
    .array(
      z.object({
        groupId: z.string().uuid(),
        priority: z.number().int().min(0).max(10_000).optional(),
        weight: z.number().int().min(0).max(10_000).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .max(100),
});
const manualCreditSchema = z.object({
  ownerId: z.string().trim().min(1).max(128),
  amountMicros: z.string().regex(/^[1-9]\d*$/),
  currency: z.string().trim().min(3).max(8).default("USD"),
  idempotencyKey: z.string().trim().min(1).max(200),
  actorId: z.string().trim().min(1).max(128).optional(),
});

export function createManagementApp(db: MarketplaceDb) {
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof z.ZodError) {
      return context.json(
        { error: { code: "invalid_request", message: "Invalid request" } },
        400,
      );
    }
    console.error("Marketplace management request failed", error);
    return context.json(
      {
        error: { code: "internal_error", message: "Management request failed" },
      },
      500,
    );
  });

  app.use("*", async (context, next) => {
    const configuredToken = process.env.MARKETPLACE_MANAGEMENT_TOKEN?.trim();
    const token =
      configuredToken ||
      (process.env.NODE_ENV === "production" ? null : DEV_MANAGEMENT_TOKEN);
    if (!token) {
      return context.json(
        {
          error: {
            code: "management_not_configured",
            message: "Management API is not configured",
          },
        },
        503,
      );
    }

    const authorization = context.req.header("authorization") ?? "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!secureEqual(supplied, token)) {
      return context.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        401,
      );
    }
    await next();
  });

  app.get("/groups", async (context) => {
    const workspaceId = z
      .string()
      .min(1)
      .parse(context.req.query("workspaceId"));
    return runManagementRequest(context, async () => ({
      data: await presentGroups(db, workspaceId),
    }));
  });

  app.get("/providers", async (context) => {
    const workspaceId = z
      .string()
      .min(1)
      .parse(context.req.query("workspaceId"));
    return runManagementRequest(context, async () => ({
      data: (await listHubProviders(db, workspaceId)).map(presentProvider),
    }));
  });

  app.post("/providers", async (context) => {
    const input = createProviderSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: presentProvider(
        await createHubProvider(db, {
          ownerWorkspaceId: input.workspace.id,
          slugBase: input.workspace.slug,
          name: input.name,
          description: input.description,
          websiteUrl: input.websiteUrl,
          providerLimit: input.providerLimit,
        }),
      ),
    }));
  });

  app.get("/groups/:groupId", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const workspaceId = z
      .string()
      .min(1)
      .parse(context.req.query("workspaceId"));
    return runManagementRequest(context, async () => ({
      data: await presentGroup(db, workspaceId, groupId),
    }));
  });

  app.get("/groups/:groupId/probe-runs", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const workspaceId = z
      .string()
      .min(1)
      .parse(context.req.query("workspaceId"));
    return runManagementRequest(context, async () => ({
      data: (await listHubGroupProbeRuns(db, workspaceId, groupId)).map(
        (run) => ({
          ...run,
          scheduledAt: run.scheduledAt.toISOString(),
          completedAt: run.completedAt.toISOString(),
        }),
      ),
    }));
  });

  app.get("/models", async (context) => {
    z.string().min(1).parse(context.req.query("workspaceId"));
    return runManagementRequest(context, async () => ({
      data: await listHubCatalogModels(db),
    }));
  });

  app.get("/available-groups", async (context) =>
    runManagementRequest(context, async () => ({
      data: await listHubAvailableGroups(db),
    })),
  );

  app.get("/market-models", async (context) =>
    runManagementRequest(context, async () => ({
      data: await listHubMarketModels(db),
    })),
  );

  app.get("/tokens", async (context) => {
    const ownerUserId = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .parse(context.req.query("ownerUserId"));
    return runManagementRequest(context, async () => ({
      data: (await listHubApiTokens(db, ownerUserId)).map(presentToken),
    }));
  });

  app.post("/tokens", async (context) => {
    const input = createTokenSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: presentToken(
        await createHubApiToken(db, {
          ownerUserId: input.ownerUserId,
          name: input.name,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        }),
      ),
    }));
  });

  app.post("/tokens/:tokenId/revoke", async (context) => {
    const tokenId = z.string().uuid().parse(context.req.param("tokenId"));
    const input = tokenOwnerSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: presentToken(
        await revokeHubApiToken(db, {
          ownerUserId: input.ownerUserId,
          tokenId,
        }),
      ),
    }));
  });

  app.get("/tokens/:tokenId/preferences", async (context) => {
    const tokenId = z.string().uuid().parse(context.req.param("tokenId"));
    const ownerUserId = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .parse(context.req.query("ownerUserId"));
    return runManagementRequest(context, async () => ({
      data: await listHubTokenGroupPreferences(db, { ownerUserId, tokenId }),
    }));
  });

  app.put("/tokens/:tokenId/preferences", async (context) => {
    const tokenId = z.string().uuid().parse(context.req.param("tokenId"));
    const input = tokenPreferencesSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: await replaceHubTokenGroupPreferences(db, {
        ownerUserId: input.ownerUserId,
        tokenId,
        preferences: input.preferences,
      }),
    }));
  });

  app.get("/tokens/:tokenId/balance", async (context) => {
    const tokenId = z.string().uuid().parse(context.req.param("tokenId"));
    const ownerUserId = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .parse(context.req.query("ownerUserId"));
    return runManagementRequest(context, async () => {
      const tokens = await listHubApiTokens(db, ownerUserId);
      if (!tokens.some((token) => token.id === tokenId)) {
        throw new HubApiTokenNotFoundError();
      }
      return {
        data: {
          ownerUserId,
          currency: "USD",
          balanceMicros: (
            await getHubLedgerBalance(db, { ownerId: ownerUserId })
          ).toString(),
        },
      };
    });
  });

  app.get("/users/:ownerUserId/activity", async (context) => {
    const ownerUserId = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .parse(context.req.param("ownerUserId"));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .parse(context.req.query("limit"));
    return runManagementRequest(context, async () => {
      const [balance, requests] = await Promise.all([
        getHubLedgerBalance(db, { ownerId: ownerUserId }),
        listHubUserRequestActivity(db, { ownerUserId, limit }),
      ]);
      return {
        data: {
          ownerUserId,
          currency: "USD",
          balanceMicros: balance.toString(),
          requests: requests.map((request) => ({
            ...request,
            createdAt: request.createdAt.toISOString(),
            completedAt: request.completedAt?.toISOString() ?? null,
          })),
        },
      };
    });
  });

  app.post("/ledger/credits", async (context) => {
    const input = manualCreditSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: await postHubManualCredit(db, {
        ownerId: input.ownerId,
        amountMicros: BigInt(input.amountMicros),
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
      }),
    }));
  });

  app.post("/groups", async (context) => {
    const input = createGroupSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      const providers = await listHubProviders(db, input.workspace.id);
      if (!providers.some((provider) => provider.id === input.providerId)) {
        throw new HubProviderNotFoundError();
      }
      const baseUrl = normalizeRadarBaseUrl(input.baseUrl);
      const discovery = await discoverOpenAiCompatibleModels({
        baseUrl,
        apiKey: input.apiKey,
      });
      const created = await createHubGroup(db, {
        ownerWorkspaceId: input.workspace.id,
        providerId: input.providerId,
        providerSlug: input.workspace.slug,
        providerName: input.workspace.name,
        name: input.name,
        description: input.description,
        baseUrlCiphertext: await encryptSecret(baseUrl),
        baseUrlHostHash: await getBaseUrlHostHash(baseUrl),
        apiKeyCiphertext: await encryptSecret(input.apiKey),
        keyFingerprint: await hashPrivateIdentifier(input.apiKey),
        apiKeyLastFour: getSecretLastFour(input.apiKey),
        multiplierBps: input.multiplierBps,
        discoveredModels: discovery.models,
      });
      return {
        data: (await presentGroups(db, input.workspace.id)).find(
          (group) => group.id === created.id,
        ),
      };
    });
  });

  app.patch("/groups/:groupId", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = updateGroupSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      let normalizedBaseUrl: string | undefined;
      let discoveredModels: string[] | undefined;
      if (
        input.baseUrl !== undefined ||
        input.apiKey !== undefined ||
        input.rediscover
      ) {
        const current = await getHubGroupEncryptedConfig(
          db,
          input.workspace.id,
          groupId,
        );
        if (current.lifecycleStatus === "retired") {
          throw new HubGroupStateError("Retired groups cannot be edited");
        }
        normalizedBaseUrl = input.baseUrl
          ? normalizeRadarBaseUrl(input.baseUrl)
          : await decryptSecret(current.baseUrlCiphertext);
        const apiKey =
          input.apiKey ?? (await decryptSecret(current.apiKeyCiphertext));
        discoveredModels = (
          await discoverOpenAiCompatibleModels({
            baseUrl: normalizedBaseUrl,
            apiKey,
          })
        ).models;
      }

      const normalizedBaseUrlForUpdate = input.baseUrl
        ? normalizedBaseUrl
        : undefined;
      if (input.baseUrl && !normalizedBaseUrlForUpdate) {
        throw new Error("A normalized Base URL is required");
      }
      await updateHubGroup(db, {
        ownerWorkspaceId: input.workspace.id,
        groupId,
        name: input.name,
        description: input.description,
        baseUrlCiphertext: normalizedBaseUrlForUpdate
          ? await encryptSecret(normalizedBaseUrlForUpdate)
          : undefined,
        baseUrlHostHash: normalizedBaseUrlForUpdate
          ? await getBaseUrlHostHash(normalizedBaseUrlForUpdate)
          : undefined,
        apiKeyCiphertext: input.apiKey
          ? await encryptSecret(input.apiKey)
          : undefined,
        keyFingerprint: input.apiKey
          ? await hashPrivateIdentifier(input.apiKey)
          : undefined,
        apiKeyLastFour: input.apiKey
          ? getSecretLastFour(input.apiKey)
          : undefined,
        multiplierBps: input.multiplierBps,
        discoveredModels,
      });
      return {
        data: (await presentGroups(db, input.workspace.id)).find(
          (group) => group.id === groupId,
        ),
      };
    });
  });

  app.post("/groups/:groupId/state", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = stateSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      await setHubGroupState(db, {
        ownerWorkspaceId: input.workspace.id,
        groupId,
        action: input.action,
      });
      return {
        data: (await presentGroups(db, input.workspace.id)).find(
          (group) => group.id === groupId,
        ),
      };
    });
  });

  app.post("/groups/:groupId/discover", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = workspaceRequestSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      const current = await getHubGroupEncryptedConfig(
        db,
        input.workspace.id,
        groupId,
      );
      const discovery = await discoverOpenAiCompatibleModels({
        baseUrl: await decryptSecret(current.baseUrlCiphertext),
        apiKey: await decryptSecret(current.apiKeyCiphertext),
      });
      await updateHubGroup(db, {
        ownerWorkspaceId: input.workspace.id,
        groupId,
        discoveredModels: discovery.models,
      });
      return {
        data: (await presentGroups(db, input.workspace.id)).find(
          (group) => group.id === groupId,
        ),
      };
    });
  });

  app.post("/groups/:groupId/probe-now", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = workspaceRequestSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: await scheduleHubGroupProbeNow(db, input.workspace.id, groupId),
    }));
  });

  app.post("/groups/:groupId/listing-request", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = workspaceRequestSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      await requestHubGroupListing(db, {
        ownerWorkspaceId: input.workspace.id,
        groupId,
      });
      return { data: await presentGroup(db, input.workspace.id, groupId) };
    });
  });

  app.post("/groups/:groupId/listing-withdraw", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = workspaceRequestSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      await withdrawHubGroupListing(db, {
        ownerWorkspaceId: input.workspace.id,
        groupId,
      });
      return { data: await presentGroup(db, input.workspace.id, groupId) };
    });
  });

  app.get("/listing-reviews", async (context) => {
    const status = z
      .enum(["private", "pending", "listed", "delisted"])
      .optional()
      .parse(context.req.query("status"));
    return runManagementRequest(context, async () => ({
      data: (await listHubListingReviews(db, status)).map((group) => ({
        ...group,
        listingSubmittedAt: group.listingSubmittedAt?.toISOString() ?? null,
        listingReviewedAt: group.listingReviewedAt?.toISOString() ?? null,
        createdAt: group.createdAt.toISOString(),
      })),
    }));
  });

  app.get("/admin/models", async (context) =>
    runManagementRequest(context, async () => ({
      data: (await listHubModelPrices(db)).map((model) => ({
        ...model,
        price: model.price
          ? {
              ...model.price,
              effectiveFrom: model.price.effectiveFrom.toISOString(),
            }
          : null,
      })),
    })),
  );

  app.put("/admin/models/:modelId/price", async (context) => {
    const modelId = z.string().uuid().parse(context.req.param("modelId"));
    const input = modelPriceSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: await replaceHubModelPrice(db, { modelId, ...input }),
    }));
  });

  app.post("/listing-reviews/:groupId", async (context) => {
    const groupId = z.string().uuid().parse(context.req.param("groupId"));
    const input = listingReviewSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: await reviewHubGroupListing(db, { groupId, ...input }),
    }));
  });

  app.post("/group-models/:groupModelId/map", async (context) => {
    const groupModelId = z
      .string()
      .uuid()
      .parse(context.req.param("groupModelId"));
    const input = mapModelSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => ({
      data: await mapHubGroupModel(db, {
        ownerWorkspaceId: input.workspace.id,
        groupModelId,
        modelId: input.modelId,
        trafficEnabled: input.trafficEnabled,
        probeEnabled: input.probeEnabled,
      }),
    }));
  });

  app.patch("/group-models/:groupModelId/config", async (context) => {
    const groupModelId = z
      .string()
      .uuid()
      .parse(context.req.param("groupModelId"));
    const input = modelConfigSchema.parse(await context.req.json());
    return runManagementRequest(context, async () => {
      const normalized = input.baseUrlOverride
        ? normalizeRadarBaseUrl(input.baseUrlOverride)
        : null;
      return {
        data: await setHubGroupModelBaseUrlOverride(db, {
          ownerWorkspaceId: input.workspace.id,
          groupModelId,
          baseUrlOverrideCiphertext: normalized
            ? await encryptSecret(normalized)
            : null,
          baseUrlOverrideHostHash: normalized
            ? await getBaseUrlHostHash(normalized)
            : null,
        }),
      };
    });
  });

  return app;
}

async function presentGroups(db: MarketplaceDb, workspaceId: string) {
  const groups = await listHubGroups(db, workspaceId);
  return Promise.all(
    groups.map(async (group) => ({
      ...group,
      baseUrl: await decryptSecret(group.baseUrlCiphertext),
      baseUrlCiphertext: undefined,
      balanceMicros: group.balanceMicros?.toString() ?? null,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      balanceCheckedAt: group.balanceCheckedAt?.toISOString() ?? null,
      listingSubmittedAt: group.listingSubmittedAt?.toISOString() ?? null,
      listingReviewedAt: group.listingReviewedAt?.toISOString() ?? null,
      models: await Promise.all(
        group.models.map(async (model) => ({
          ...model,
          baseUrlOverride: model.baseUrlOverrideCiphertext
            ? await decryptSecret(model.baseUrlOverrideCiphertext)
            : null,
          baseUrlOverrideCiphertext: undefined,
          lastCheckAt: model.lastCheckAt?.toISOString() ?? null,
        })),
      ),
    })),
  );
}

async function presentGroup(
  db: MarketplaceDb,
  workspaceId: string,
  groupId: string,
) {
  const group = await getHubGroup(db, workspaceId, groupId);
  return {
    ...group,
    baseUrl: await decryptSecret(group.baseUrlCiphertext),
    baseUrlCiphertext: undefined,
    balanceMicros: group.balanceMicros?.toString() ?? null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    balanceCheckedAt: group.balanceCheckedAt?.toISOString() ?? null,
    listingSubmittedAt: group.listingSubmittedAt?.toISOString() ?? null,
    listingReviewedAt: group.listingReviewedAt?.toISOString() ?? null,
    models: await Promise.all(
      group.models.map(async (model) => ({
        ...model,
        baseUrlOverride: model.baseUrlOverrideCiphertext
          ? await decryptSecret(model.baseUrlOverrideCiphertext)
          : null,
        baseUrlOverrideCiphertext: undefined,
        lastCheckAt: model.lastCheckAt?.toISOString() ?? null,
      })),
    ),
  };
}

async function runManagementRequest(
  context: Context,
  execute: () => Promise<unknown>,
) {
  try {
    return context.json(await execute());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return context.json(
        { error: { code: "invalid_request", message: "Invalid request" } },
        400,
      );
    }
    if (error instanceof HubGroupNotFoundError) {
      return context.json(
        { error: { code: "group_not_found", message: error.message } },
        404,
      );
    }
    if (error instanceof HubProviderNotFoundError) {
      return context.json(
        { error: { code: "provider_not_found", message: error.message } },
        404,
      );
    }
    if (error instanceof HubProviderLimitError) {
      return context.json(
        { error: { code: "provider_limit", message: error.message } },
        409,
      );
    }
    if (error instanceof HubProviderConflictError) {
      return context.json(
        { error: { code: "provider_conflict", message: error.message } },
        409,
      );
    }
    if (error instanceof HubModelNotFoundError) {
      return context.json(
        { error: { code: "model_not_found", message: error.message } },
        404,
      );
    }
    if (error instanceof HubModelPriceValidationError) {
      return context.json(
        { error: { code: "invalid_model_price", message: error.message } },
        400,
      );
    }
    if (error instanceof HubGroupStateError) {
      return context.json(
        { error: { code: "invalid_group_state", message: error.message } },
        409,
      );
    }
    if (error instanceof HubApiTokenNotFoundError) {
      return context.json(
        { error: { code: "token_not_found", message: error.message } },
        404,
      );
    }
    if (error instanceof HubApiTokenRevokedError) {
      return context.json(
        { error: { code: "token_revoked", message: error.message } },
        409,
      );
    }
    if (error instanceof HubRoutingError) {
      return context.json(
        { error: { code: "invalid_routing_request", message: error.message } },
        400,
      );
    }
    if (isValidationServiceError(error)) {
      return context.json(
        { error: { code: "upstream_validation", message: error.message } },
        400,
      );
    }
    console.error("Marketplace management request failed", error);
    return context.json(
      {
        error: { code: "internal_error", message: "Management request failed" },
      },
      500,
    );
  }
}

function presentToken(
  token:
    | Awaited<ReturnType<typeof createHubApiToken>>
    | Awaited<ReturnType<typeof listHubApiTokens>>[number],
) {
  return {
    id: token.id,
    ownerUserId: token.ownerUserId,
    name: token.name,
    prefix: token.prefix,
    status: token.status,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString(),
    ...("token" in token ? { token: token.token } : {}),
  };
}

function presentProvider(
  provider:
    | Awaited<ReturnType<typeof createHubProvider>>
    | Awaited<ReturnType<typeof listHubProviders>>[number],
) {
  return {
    ...provider,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function isValidationServiceError(
  error: unknown,
): error is Error & { code: "VALIDATION" } {
  return (
    error instanceof Error && "code" in error && error.code === "VALIDATION"
  );
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
