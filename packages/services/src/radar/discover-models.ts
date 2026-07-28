import { and, eq, isNull } from "@openstatus/db";
import { radarPool, radarProvider } from "@openstatus/db/src/schema";

import { requireScope } from "../auth";
import { getReadDb, type ServiceContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { normalizeRadarBaseUrl } from "./base-url";
import { decryptSecret } from "./crypto";
import {
  DiscoverRadarModelsForPoolInput,
  DiscoverRadarModelsInput,
} from "./schemas";

const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_MODELS = 200;

export async function discoverRadarModels(args: {
  ctx: ServiceContext;
  input: DiscoverRadarModelsInput;
  fetch?: typeof fetch;
}) {
  requireScope(args.ctx, "read");
  const input = DiscoverRadarModelsInput.parse(args.input);
  const baseUrl = normalizeRadarBaseUrl(input.baseUrl);
  const url = buildModelsUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  const doFetch = args.fetch ?? fetch;

  try {
    const response = await doFetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new ValidationError(
        `Model discovery failed: HTTP ${response.status}${await readErrorSuffix(
          response,
          input.apiKey,
        )}`,
      );
    }

    const json = await response.json();
    const models = extractModelIds(json);

    if (models.length === 0) {
      throw new ValidationError("Model discovery returned no models.");
    }

    return { models };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ValidationError(
        "Model discovery timed out. You can enter the probe model manually and continue.",
      );
    }
    if (isNetworkFetchFailure(error)) {
      throw new ValidationError(
        `Model discovery failed: could not reach ${hostFromUrl(url)}. Please check the provider Base URL.`,
      );
    }
    throw new ValidationError(
      `Model discovery failed: ${toErrorMessage(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverRadarModelsForPool(args: {
  ctx: ServiceContext;
  input: DiscoverRadarModelsForPoolInput;
  fetch?: typeof fetch;
}) {
  requireScope(args.ctx, "read");
  const input = DiscoverRadarModelsForPoolInput.parse(args.input);
  const db = getReadDb(args.ctx);

  const pool = await db
    .select({ id: radarPool.id })
    .from(radarPool)
    .where(
      and(
        eq(radarPool.slug, input.poolSlug),
        eq(radarPool.workspaceId, args.ctx.workspace.id),
        isNull(radarPool.deletedAt),
      ),
    )
    .get();

  if (!pool) throw new NotFoundError("radar_pool", input.poolSlug);

  const providers = await db
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

  return discoverRadarModels({
    ctx: args.ctx,
    input: {
      baseUrl: await decryptSecret(provider.baseUrlEncrypted),
      apiKey: input.apiKey,
    },
    fetch: args.fetch,
  });
}

export function buildModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/models")) {
    return url.toString();
  }

  if (pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/models`;
    return url.toString();
  }

  url.pathname = `${pathname}/v1/models`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function extractModelIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return [];
  }

  const ids = value.data
    .map((item) =>
      isRecord(item) && typeof item.id === "string" ? item.id : "",
    )
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_MODELS);

  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

async function readErrorSuffix(response: Response, apiKey: string) {
  try {
    const body = await response.text();
    const summary = body
      .split(apiKey)
      .join("[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return summary ? `: ${summary}` : "";
  } catch {
    return "";
  }
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isNetworkFetchFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("getaddrinfo") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

function hostFromUrl(input: string) {
  try {
    return new URL(input).host;
  } catch {
    return "provider";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
