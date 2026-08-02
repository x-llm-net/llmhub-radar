import {
  authenticateHubApiToken,
  authorizeHubUsage,
  createHubRequest,
  finishHubRequest,
  getCurrentHubRouteCandidate,
  HubInsufficientBalanceError,
  HubPricingUnavailableError,
  planHubRoute,
  postHubUsageCharge,
  quoteHubUsageAuthorization,
  recordHubRequestAttempt,
  releaseHubUsageAuthorization,
  stageHubUsageSettlement,
  type MarketplaceDb,
} from "@llmhub/marketplace-db";
import { Hono } from "hono";
import { z } from "zod";

const chatRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(256),
    stream: z.boolean().optional().default(false),
  })
  .passthrough();

export type HubTrafficAdapterInput = {
  requestId: string;
  externalChannelId: string;
  model: string;
  body: Record<string, unknown>;
};

export type HubTrafficAdapterResponse = {
  status: number;
  body: unknown;
  upstreamRequestId?: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

export type HubTrafficAdapter = {
  forward(input: HubTrafficAdapterInput): Promise<HubTrafficAdapterResponse>;
};

export function createUnavailableHubTrafficAdapter(): HubTrafficAdapter {
  return {
    async forward() {
      return {
        status: 503,
        body: {
          error: {
            code: "relay_not_configured",
            message: "The relay traffic adapter is not configured",
          },
        },
      };
    },
  };
}

export function createFakeHubTrafficAdapter(
  options: {
    failChannelIds?: readonly string[];
    failOnceChannelIds?: readonly string[];
    responseUsage?: HubTrafficAdapterResponse["usage"];
  } = {},
): HubTrafficAdapter {
  const alwaysFail = new Set(options.failChannelIds ?? []);
  const failOnce = new Set(options.failOnceChannelIds ?? []);
  let sequence = 0;
  return {
    async forward(input) {
      if (
        alwaysFail.has(input.externalChannelId) ||
        failOnce.delete(input.externalChannelId)
      ) {
        return {
          status: 503,
          body: {
            error: {
              code: "fake_upstream_failure",
              message: "Fake upstream failure",
            },
          },
        };
      }
      sequence += 1;
      return {
        status: 200,
        body: {
          id: `fake-chatcmpl-${sequence}`,
          object: "chat.completion",
          model: input.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "fake relay response" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: options.responseUsage?.inputTokens ?? 10,
            completion_tokens: options.responseUsage?.outputTokens ?? 5,
            total_tokens:
              (options.responseUsage?.inputTokens ?? 10) +
              (options.responseUsage?.outputTokens ?? 5),
          },
        },
        usage: options.responseUsage ?? { inputTokens: 10, outputTokens: 5 },
        upstreamRequestId: `fake-request-${sequence}`,
      };
    },
  };
}

export function createHttpHubTrafficAdapter(options: {
  endpoint: string;
  token: string;
  fetch?: typeof fetch;
}): HubTrafficAdapter {
  const endpoint = internalRelayEndpoint(options.endpoint);
  const doFetch = options.fetch ?? fetch;
  return {
    async forward(input) {
      const url = new URL(
        `channels/${encodeURIComponent(input.externalChannelId)}/chat/completions`,
        endpoint.toString().replace(/\/?$/, "/"),
      );
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          "x-llmhub-request-id": input.requestId,
        },
        body: JSON.stringify({ ...input.body, model: input.model }),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json().catch(() => null);
      const usage = readUsage(body);
      return {
        status: response.status,
        body,
        usage,
        upstreamRequestId:
          response.headers.get("x-request-id") ??
          response.headers.get("request-id"),
      };
    },
  };
}

export function createHubGatewayApp(
  db: MarketplaceDb,
  options: { trafficAdapter?: HubTrafficAdapter } = {},
) {
  const app = new Hono();
  const trafficAdapter =
    options.trafficAdapter ?? createUnavailableHubTrafficAdapter();

  app.post("/chat/completions", async (context) => {
    const suppliedToken = readBearerToken(context.req.header("authorization"));
    const token = suppliedToken
      ? await authenticateHubApiToken(db, suppliedToken)
      : null;
    if (!token) {
      return context.json(
        { error: { code: "invalid_api_key", message: "Invalid API key" } },
        401,
      );
    }

    const parsed = chatRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "invalid_request", message: "Invalid chat request" } },
        400,
      );
    }
    if (parsed.data.stream) {
      return context.json(
        {
          error: {
            code: "streaming_not_available",
            message: "Streaming is not available in the first router version",
          },
        },
        400,
      );
    }

    let route;
    try {
      route = await planHubRoute(db, {
        tokenId: token.id,
        model: parsed.data.model,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "HubRouteUnavailableError") {
        return context.json(
          { error: { code: "no_route", message: error.message } },
          503,
        );
      }
      throw error;
    }
    if (route.candidates.length === 0) {
      return context.json(
        {
          error: { code: "no_route", message: "No active route is available" },
        },
        503,
      );
    }

    const request = await createHubRequest(db, {
      ownerUserId: token.ownerUserId,
      tokenId: token.id,
      canonicalModelId: route.model.id,
      routePlan: route.candidates,
      routePlanVersion: token.routingRevision,
    });
    let authorization;
    try {
      const amountMicros = await quoteHubUsageAuthorization(db, {
        modelId: route.model.id,
        groupIds: route.candidates.map((candidate) => candidate.groupId),
        usage: estimateHubAuthorizationUsage(parsed.data),
      });
      authorization = (
        await authorizeHubUsage(db, {
          ownerId: token.ownerUserId,
          requestId: request.id,
          amountMicros,
        })
      ).authorization;
    } catch (error) {
      await finishHubRequest(db, { requestId: request.id, status: "failed" });
      if (error instanceof HubInsufficientBalanceError) {
        return context.json(
          { error: { code: "insufficient_balance", message: error.message } },
          402,
        );
      }
      if (error instanceof HubPricingUnavailableError) {
        return context.json(
          { error: { code: "pricing_unavailable", message: error.message } },
          503,
        );
      }
      throw error;
    }

    let authorizationSettled = false;
    let upstreamSucceededForBilling = false;
    try {
      let lastResponse: HubTrafficAdapterResponse | null = null;

      for (let index = 0; index < route.candidates.length; index += 1) {
        const candidate = route.candidates[index];
        if (!candidate) continue;
        const attemptNo = index + 1;
        const startedAt = new Date();
        const current = await getCurrentHubRouteCandidate(db, candidate);
        if (!current) {
          const completedAt = new Date();
          await recordHubRequestAttempt(db, {
            requestId: request.id,
            attemptNo,
            candidate,
            outcome: "aborted",
            errorCode: "route_changed",
            startedAt,
            completedAt,
          });
          continue;
        }

        let response: HubTrafficAdapterResponse;
        try {
          response = await trafficAdapter.forward({
            requestId: request.id,
            externalChannelId: current.externalChannelId,
            model: parsed.data.model,
            body: parsed.data,
          });
        } catch (error) {
          response = {
            status: 502,
            body: { error: { code: "relay_error", message: safeError(error) } },
          };
        }
        lastResponse = response;
        const completedAt = new Date();
        const usage = response.usage ?? readUsage(response.body);
        const upstreamSucceeded =
          response.status >= 200 && response.status < 300;
        const outcome =
          upstreamSucceeded && usage
            ? "success"
            : response.status === 401 || response.status === 403
              ? "configuration_error"
              : "provider_failure";
        if (outcome === "success" && usage) {
          upstreamSucceededForBilling = true;
          await stageHubUsageSettlement(db, {
            authorizationId: authorization.id,
            payload: {
              ownerId: token.ownerUserId,
              tokenId: token.id,
              requestId: request.id,
              sourceSystem: "llmhub-gateway",
              sourceEventId: request.id,
              modelId: route.model.id,
              groupId: current.groupId,
              finalGroupModelId: current.groupModelId,
              usage,
              externalRequestId: response.upstreamRequestId,
            },
            attempt: {
              attemptNo,
              groupModelId: current.groupModelId,
              relayChannelBindingId: current.relayChannelBindingId,
              externalChannelId: current.externalChannelId,
              configVersion: current.configVersion,
              upstreamRequestId: response.upstreamRequestId,
              startedAt,
              completedAt,
            },
          });
        } else {
          await recordHubRequestAttempt(db, {
            requestId: request.id,
            attemptNo,
            candidate,
            outcome,
            errorCode: upstreamSucceeded
              ? "usage_missing"
              : readErrorCode(response.body),
            upstreamRequestId: response.upstreamRequestId,
            startedAt,
            completedAt,
          });
        }

        if (upstreamSucceeded && !usage) {
          await finishHubRequest(db, {
            requestId: request.id,
            status: "failed",
          });
          return context.json(
            {
              error: {
                code: "usage_missing",
                message: "The upstream response did not include usage data",
              },
            },
            502,
          );
        }
        if (outcome !== "success") {
          if (isRetryableRelayStatus(response.status)) continue;
          await finishHubRequest(db, {
            requestId: request.id,
            status: "failed",
          });
          return context.json(response.body, response.status as 400);
        }
        if (!usage) throw new Error("Successful relay response has no usage");

        try {
          await postHubUsageCharge(db, {
            ownerId: token.ownerUserId,
            tokenId: token.id,
            requestId: request.id,
            sourceSystem: "llmhub-gateway",
            sourceEventId: request.id,
            modelId: route.model.id,
            groupId: current.groupId,
            finalGroupModelId: current.groupModelId,
            usage,
            authorizationId: authorization.id,
            externalRequestId: response.upstreamRequestId,
          });
          authorizationSettled = true;
        } catch (error) {
          if (error instanceof HubInsufficientBalanceError) {
            return context.json(
              {
                error: { code: "insufficient_balance", message: error.message },
              },
              402,
            );
          }
          if (error instanceof HubPricingUnavailableError) {
            return context.json(
              {
                error: { code: "pricing_unavailable", message: error.message },
              },
              503,
            );
          }
          throw error;
        }
        return context.json(response.body, response.status as 200);
      }

      await finishHubRequest(db, { requestId: request.id, status: "failed" });
      return context.json(
        lastResponse?.body ?? {
          error: { code: "all_routes_failed", message: "All routes failed" },
        },
        502,
      );
    } finally {
      if (!authorizationSettled && !upstreamSucceededForBilling) {
        await releaseHubUsageAuthorization(db, {
          authorizationId: authorization.id,
        });
      }
    }
  });

  return app;
}

function readBearerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

function estimateHubAuthorizationUsage(body: Record<string, unknown>) {
  const inputTokens = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  const requestedOutputTokens = [
    body.max_completion_tokens,
    body.max_tokens,
  ].find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  return {
    inputTokens,
    outputTokens: requestedOutputTokens
      ? Math.floor(requestedOutputTokens)
      : 4_096,
  };
}

function readUsage(body: unknown) {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;
  if (
    !isNonNegativeNumber(body.usage.prompt_tokens) &&
    !isNonNegativeNumber(body.usage.completion_tokens) &&
    !isNonNegativeNumber(body.usage.cache_read_input_tokens) &&
    !isNonNegativeNumber(body.usage.cache_creation_input_tokens)
  ) {
    return undefined;
  }
  return {
    inputTokens: readNonNegativeInteger(body.usage.prompt_tokens),
    outputTokens: readNonNegativeInteger(body.usage.completion_tokens),
    cacheReadTokens: readNonNegativeInteger(body.usage.cache_read_input_tokens),
    cacheWriteTokens: readNonNegativeInteger(
      body.usage.cache_creation_input_tokens,
    ),
  };
}

function isRetryableRelayStatus(status: number) {
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

function internalRelayEndpoint(value: string) {
  const endpoint = new URL(value);
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") {
    throw new Error("Internal relay endpoints must use HTTPS in production");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("Internal relay endpoints must use HTTP or HTTPS");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Internal relay endpoints must not include credentials");
  }
  return endpoint;
}

function readErrorCode(body: unknown) {
  if (
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === "string"
  ) {
    return body.error.code.slice(0, 128);
  }
  return "upstream_failure";
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function isNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeError(error: unknown) {
  return (
    error instanceof Error ? error.message : "Relay request failed"
  ).slice(0, 200);
}
