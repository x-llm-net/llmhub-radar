import { getRadarActorAccess } from "@openstatus/services/radar";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { toServiceCtx } from "../service-adapter";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const DEV_MANAGEMENT_TOKEN = "llmhub-marketplace-local-management";
const MANAGEMENT_TIMEOUT_MS = 30_000;

const groupModelSchema = z.object({
  id: z.string().uuid(),
  modelId: z.string().uuid().nullable(),
  upstreamName: z.string(),
  discoveryStatus: z.enum(["unmapped", "active", "missing", "retired"]),
  trafficEnabled: z.boolean(),
  probeEnabled: z.boolean(),
  baseUrlOverride: z.string().nullable(),
  canonicalName: z.string().nullable(),
  displayName: z.string().nullable(),
  availabilityBps: z.number().int().nullable(),
  firstTokenP50Ms: z.number().int().nullable(),
  firstTokenP95Ms: z.number().int().nullable(),
  sampleCount: z.number().int(),
  currentStatus: z.enum([
    "unknown",
    "normal",
    "degraded",
    "down",
    "configuration_error",
    "stale",
  ]),
  lastCheckAt: z.string().nullable(),
});

const groupSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  providerName: z.string(),
  name: z.string(),
  description: z.string(),
  baseUrl: z.string(),
  apiKeyLastFour: z.string(),
  lifecycleStatus: z.enum(["draft", "verifying", "ready", "retired"]),
  desiredStatus: z.enum(["active", "paused", "retired"]),
  listingStatus: z.enum(["private", "pending", "listed", "delisted"]),
  listingSubmittedAt: z.string().nullable(),
  listingReviewedAt: z.string().nullable(),
  listingReviewedBy: z.string().nullable(),
  listingReviewNote: z.string().nullable(),
  configVersion: z.number().int(),
  multiplierBps: z.number().int().nullable(),
  balanceMicros: z.string().nullable(),
  balanceCurrency: z.string().nullable(),
  balanceStatus: z.enum(["unknown", "available", "low", "exhausted", "error"]),
  balanceCheckedAt: z.string().nullable(),
  models: z.array(groupModelSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const catalogModelSchema = z.object({
  id: z.string().uuid(),
  canonicalName: z.string(),
  displayName: z.string(),
  vendor: z.string(),
  family: z.string(),
  status: z.enum(["active", "deprecated", "retired"]),
});

const probeRunSchema = z.object({
  cycleId: z.string().uuid(),
  groupModelId: z.string().uuid(),
  modelName: z.string(),
  upstreamModelName: z.string(),
  outcome: z.enum([
    "success",
    "provider_failure",
    "configuration_error",
    "observer_error",
  ]),
  httpStatus: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  safeErrorSummary: z.string().nullable(),
  firstTokenMs: z.number().int().nullable(),
  totalLatencyMs: z.number().int(),
  scheduledAt: z.string(),
  completedAt: z.string(),
});

const createGroupInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1).max(4096),
  multiplierBps: z.number().int().min(0).max(1_000_000),
});

const updateGroupInput = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  multiplierBps: z.number().int().min(0).max(1_000_000).optional(),
  rediscover: z.boolean().default(false),
});

const listingReviewSchema = z.object({
  id: z.string().uuid(),
  providerName: z.string(),
  ownerWorkspaceId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  lifecycleStatus: z.enum(["draft", "verifying", "ready", "retired"]),
  desiredStatus: z.enum(["active", "paused", "retired"]),
  listingStatus: z.enum(["private", "pending", "listed", "delisted"]),
  listingSubmittedAt: z.string().nullable(),
  listingReviewedAt: z.string().nullable(),
  listingReviewedBy: z.string().nullable(),
  listingReviewNote: z.string().nullable(),
  balanceStatus: z.enum(["unknown", "available", "low", "exhausted", "error"]),
  createdAt: z.string(),
  models: z.array(
    z.object({
      displayName: z.string().nullable(),
      priceReady: z.boolean(),
      currentStatus: z.enum([
        "unknown",
        "normal",
        "degraded",
        "down",
        "configuration_error",
        "stale",
      ]),
      sampleCount: z.number().int(),
    }),
  ),
});

const modelPriceComponentSchema = z.object({
  component: z.enum(["input_text", "output_text", "cache_read", "cache_write"]),
  unit: z.literal("million_tokens"),
  unitSize: z.number().int().positive(),
  amountMicros: z.string().regex(/^(0|[1-9]\d*)$/),
});

const modelPriceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  vendor: z.string(),
  family: z.string(),
  canonicalName: z.string(),
  displayName: z.string(),
  shortName: z.string(),
  status: z.enum(["active", "deprecated", "retired"]),
  sortOrder: z.number().int(),
  price: z
    .object({
      versionId: z.string().uuid(),
      currency: z.literal("USD"),
      billingMode: z.literal("token"),
      effectiveFrom: z.string(),
      source: z.string(),
      sourceVersion: z.string().nullable(),
      changedByUserId: z.string().nullable(),
      changeReason: z.string(),
      components: z.array(modelPriceComponentSchema),
    })
    .nullable(),
});

const tokenSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string(),
  name: z.string(),
  prefix: z.string(),
  status: z.enum(["active", "revoked"]),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  token: z.string().optional(),
});

const tokenPreferenceSchema = z.object({
  groupId: z.string().uuid(),
  providerName: z.string(),
  groupName: z.string(),
  priority: z.number().int(),
  weight: z.number().int(),
  enabled: z.boolean(),
  updatedAt: z.string(),
});

const availableGroupSchema = z.object({
  groupId: z.string().uuid(),
  providerName: z.string(),
  groupName: z.string(),
  description: z.string(),
  balanceStatus: z.enum(["unknown", "available", "low", "exhausted", "error"]),
});

const marketModelSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  vendor: z.string(),
  family: z.string(),
  canonicalName: z.string(),
  displayName: z.string(),
  officialInputPriceMicros: z.string().regex(/^\d+$/),
  officialOutputPriceMicros: z.string().regex(/^\d+$/),
  offers: z.array(
    z.object({
      groupModelId: z.string().uuid(),
      groupId: z.string().uuid(),
      providerName: z.string(),
      groupName: z.string(),
      description: z.string(),
      multiplierBps: z.number().int().nonnegative(),
      inputPriceMicros: z.string().regex(/^\d+$/),
      outputPriceMicros: z.string().regex(/^\d+$/),
      availabilityBps: z.number().int().nullable(),
      firstTokenP50Ms: z.number().int().nullable(),
      sampleCount: z.number().int().nonnegative(),
      currentStatus: z.enum([
        "unknown",
        "normal",
        "degraded",
        "down",
        "configuration_error",
        "stale",
      ]),
      naturalRank: z.number().int().nonnegative(),
    }),
  ),
});

const userActivitySchema = z.object({
  ownerUserId: z.string(),
  currency: z.string(),
  balanceMicros: z.string().regex(/^-?\d+$/),
  requests: z.array(
    z.object({
      requestId: z.string().uuid(),
      status: z.enum(["planned", "running", "succeeded", "failed"]),
      tokenId: z.string().uuid(),
      tokenName: z.string(),
      modelName: z.string(),
      providerName: z.string().nullable(),
      groupName: z.string().nullable(),
      attemptCount: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      cacheWriteTokens: z.number().int().nonnegative(),
      chargedAmountMicros: z.string().regex(/^\d+$/).nullable(),
      billingStatus: z
        .enum(["reserved", "captured", "released", "expired"])
        .nullable(),
      currency: z.string(),
      createdAt: z.string(),
      completedAt: z.string().nullable(),
    }),
  ),
});

const platformAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const access = await getRadarActorAccess({ ctx: toServiceCtx(ctx) });
  if (!access.isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Platform administrator access is required",
    });
  }
  return next();
});

export const hubRouter = createTRPCRouter({
  access: protectedProcedure.query(async ({ ctx }) => {
    const access = await getRadarActorAccess({ ctx: toServiceCtx(ctx) });
    return { isPlatformAdmin: access.isAdmin };
  }),

  groups: protectedProcedure.query(async ({ ctx }) => {
    const query = new URLSearchParams({
      workspaceId: String(ctx.workspace.id),
    });
    return managementRequest(
      `/groups?${query}`,
      { method: "GET" },
      z.array(groupSchema),
    );
  }),

  group: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const query = new URLSearchParams({
        workspaceId: String(ctx.workspace.id),
      });
      return managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}?${query}`,
        { method: "GET" },
        groupSchema,
      );
    }),

  groupProbeRuns: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const query = new URLSearchParams({
        workspaceId: String(ctx.workspace.id),
      });
      return managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}/probe-runs?${query}`,
        { method: "GET" },
        z.array(probeRunSchema),
      );
    }),

  catalogModels: protectedProcedure.query(async ({ ctx }) => {
    const query = new URLSearchParams({
      workspaceId: String(ctx.workspace.id),
    });
    return managementRequest(
      `/models?${query}`,
      { method: "GET" },
      z.array(catalogModelSchema),
    );
  }),

  availableGroups: protectedProcedure.query(() =>
    managementRequest(
      "/available-groups",
      { method: "GET" },
      z.array(availableGroupSchema),
    ),
  ),

  marketModels: protectedProcedure.query(() =>
    managementRequest(
      "/market-models",
      { method: "GET" },
      z.array(marketModelSchema),
    ),
  ),

  tokens: protectedProcedure.query(async ({ ctx }) => {
    const query = new URLSearchParams({
      ownerUserId: String(ctx.user.id),
    });
    return managementRequest(
      `/tokens?${query}`,
      { method: "GET" },
      z.array(tokenSchema),
    );
  }),

  createToken: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        expiresAt: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        "/tokens",
        {
          method: "POST",
          body: JSON.stringify({
            ownerUserId: String(ctx.user.id),
            ...input,
          }),
        },
        tokenSchema,
      ),
    ),

  revokeToken: protectedProcedure
    .input(z.object({ tokenId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/tokens/${encodeURIComponent(input.tokenId)}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ ownerUserId: String(ctx.user.id) }),
        },
        tokenSchema,
      ),
    ),

  tokenPreferences: protectedProcedure
    .input(z.object({ tokenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const query = new URLSearchParams({
        ownerUserId: String(ctx.user.id),
      });
      return managementRequest(
        `/tokens/${encodeURIComponent(input.tokenId)}/preferences?${query}`,
        { method: "GET" },
        z.array(tokenPreferenceSchema),
      );
    }),

  replaceTokenPreferences: protectedProcedure
    .input(
      z.object({
        tokenId: z.string().uuid(),
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
      }),
    )
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/tokens/${encodeURIComponent(input.tokenId)}/preferences`,
        {
          method: "PUT",
          body: JSON.stringify({
            ownerUserId: String(ctx.user.id),
            preferences: input.preferences,
          }),
        },
        z.array(tokenPreferenceSchema),
      ),
    ),

  tokenBalance: protectedProcedure
    .input(z.object({ tokenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const query = new URLSearchParams({
        ownerUserId: String(ctx.user.id),
      });
      return managementRequest(
        `/tokens/${encodeURIComponent(input.tokenId)}/balance?${query}`,
        { method: "GET" },
        z.object({
          ownerUserId: z.string(),
          currency: z.string(),
          balanceMicros: z.string(),
        }),
      );
    }),

  activity: protectedProcedure.query(async ({ ctx }) =>
    managementRequest(
      `/users/${encodeURIComponent(String(ctx.user.id))}/activity?limit=50`,
      { method: "GET" },
      userActivitySchema,
    ),
  ),

  createGroup: protectedProcedure
    .input(createGroupInput)
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        "/groups",
        {
          method: "POST",
          body: JSON.stringify({
            ...input,
            workspace: workspacePayload(ctx.workspace),
          }),
        },
        groupSchema,
      ),
    ),

  updateGroup: protectedProcedure
    .input(updateGroupInput)
    .mutation(async ({ ctx, input }) => {
      const { groupId, ...changes } = input;
      return managementRequest(
        `/groups/${encodeURIComponent(groupId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...changes,
            workspace: workspacePayload(ctx.workspace),
          }),
        },
        groupSchema,
      );
    }),

  setGroupState: protectedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        action: z.enum(["pause", "resume", "retire"]),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}/state`,
        {
          method: "POST",
          body: JSON.stringify({
            workspace: workspacePayload(ctx.workspace),
            action: input.action,
          }),
        },
        groupSchema,
      ),
    ),

  discoverGroupModels: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}/discover`,
        {
          method: "POST",
          body: JSON.stringify({ workspace: workspacePayload(ctx.workspace) }),
        },
        groupSchema,
      ),
    ),

  probeGroupNow: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}/probe-now`,
        {
          method: "POST",
          body: JSON.stringify({ workspace: workspacePayload(ctx.workspace) }),
        },
        z.object({ scheduled: z.number().int().nonnegative() }),
      ),
    ),

  requestGroupListing: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}/listing-request`,
        {
          method: "POST",
          body: JSON.stringify({ workspace: workspacePayload(ctx.workspace) }),
        },
        groupSchema,
      ),
    ),

  withdrawGroupListing: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      managementRequest(
        `/groups/${encodeURIComponent(input.groupId)}/listing-withdraw`,
        {
          method: "POST",
          body: JSON.stringify({ workspace: workspacePayload(ctx.workspace) }),
        },
        groupSchema,
      ),
    ),

  listingReviews: platformAdminProcedure
    .input(
      z
        .object({
          status: z
            .enum(["private", "pending", "listed", "delisted"])
            .default("pending"),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const query = new URLSearchParams({ status: input?.status ?? "pending" });
      return managementRequest(
        `/listing-reviews?${query}`,
        { method: "GET" },
        z.array(listingReviewSchema),
      );
    }),

  modelPrices: platformAdminProcedure.query(() =>
    managementRequest(
      "/admin/models",
      { method: "GET" },
      z.array(modelPriceSchema),
    ),
  ),

  updateModelPrice: platformAdminProcedure
    .input(
      z.object({
        modelId: z.string().uuid(),
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
        changeReason: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { modelId, ...price } = input;
      return managementRequest(
        `/admin/models/${encodeURIComponent(modelId)}/price`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...price,
            changedByUserId: String(ctx.user.id),
          }),
        },
        z.object({
          modelId: z.string().uuid(),
          versionId: z.string().uuid(),
          effectiveFrom: z.string(),
        }),
      );
    }),

  reviewGroupListing: platformAdminProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { groupId, ...review } = input;
      return managementRequest(
        `/listing-reviews/${encodeURIComponent(groupId)}`,
        {
          method: "POST",
          body: JSON.stringify({ ...review, reviewer: String(ctx.user.id) }),
        },
        z.object({ id: z.string().uuid() }),
      );
    }),

  mapGroupModel: protectedProcedure
    .input(
      z.object({
        groupModelId: z.string().uuid(),
        modelId: z.string().uuid().nullable(),
        trafficEnabled: z.boolean().optional(),
        probeEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { groupModelId, ...mapping } = input;
      return managementRequest(
        `/group-models/${encodeURIComponent(groupModelId)}/map`,
        {
          method: "POST",
          body: JSON.stringify({
            ...mapping,
            workspace: workspacePayload(ctx.workspace),
          }),
        },
        z.object({ id: z.string().uuid() }),
      );
    }),

  updateGroupModelConfig: protectedProcedure
    .input(
      z.object({
        groupModelId: z.string().uuid(),
        baseUrlOverride: z.string().trim().url().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { groupModelId, ...config } = input;
      return managementRequest(
        `/group-models/${encodeURIComponent(groupModelId)}/config`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...config,
            workspace: workspacePayload(ctx.workspace),
          }),
        },
        z.object({ id: z.string().uuid(), changed: z.boolean() }),
      );
    }),
});

function workspacePayload(workspace: {
  id: number | string;
  slug: string;
  name: string | null;
}) {
  return {
    id: String(workspace.id),
    slug: workspace.slug,
    name: workspace.name?.trim() || workspace.slug,
  };
}

async function managementRequest<T extends z.ZodTypeAny>(
  pathname: string,
  init: RequestInit,
  schema: T,
): Promise<z.infer<T>> {
  const baseUrl = (
    process.env.MARKETPLACE_API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_MARKETPLACE_API_URL ??
    "http://127.0.0.1:3010"
  ).replace(/\/+$/, "");
  const configuredToken = process.env.MARKETPLACE_MANAGEMENT_TOKEN?.trim();
  const token =
    configuredToken ||
    (process.env.NODE_ENV === "production" ? null : DEV_MANAGEMENT_TOKEN);
  if (!token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Marketplace management is not configured",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANAGEMENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/manage${pathname}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = readErrorMessage(payload) ?? "Marketplace request failed";
      throw new TRPCError({
        code:
          response.status === 400
            ? "BAD_REQUEST"
            : response.status === 401
              ? "UNAUTHORIZED"
              : response.status === 404
                ? "NOT_FOUND"
                : response.status === 409
                  ? "CONFLICT"
                  : "INTERNAL_SERVER_ERROR",
        message,
      });
    }
    return schema.parse(
      typeof payload === "object" && payload !== null && "data" in payload
        ? payload.data
        : undefined,
    );
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TRPCError({
        code: "TIMEOUT",
        message: "Marketplace request timed out",
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Marketplace service is unavailable",
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function readErrorMessage(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return null;
}
