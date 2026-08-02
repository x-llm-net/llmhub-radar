import { ValidationError } from "../errors";
import { normalizeRadarBaseUrl } from "./base-url";
import { safeUpstreamFetch } from "./safe-fetch";

const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_MODELS = 200;

export async function discoverOpenAiCompatibleModels(args: {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}) {
  const baseUrl = normalizeRadarBaseUrl(args.baseUrl);
  const url = buildModelsUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  const doFetch = args.fetch ?? fetch;

  try {
    const response = await safeUpstreamFetch(
      url,
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${args.apiKey}`,
        },
      },
      doFetch,
    );

    if (!response.ok) {
      throw new ValidationError(
        `Model discovery failed: HTTP ${response.status}${await readErrorSuffix(
          response,
          args.apiKey,
        )}`,
      );
    }

    const models = extractModelIds(await response.json());
    if (models.length === 0) {
      throw new ValidationError("Model discovery returned no models.");
    }
    return { models };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ValidationError("Model discovery timed out.");
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

export function buildModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/models")) return url.toString();
  if (pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/models`;
    return url.toString();
  }
  url.pathname = `${pathname}/v1/models`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function extractModelIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
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
    const summary = (await response.text())
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
  return error instanceof Error ? error.message : String(error);
}

function isNetworkFetchFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return [
    "fetch failed",
    "getaddrinfo",
    "enotfound",
    "econnrefused",
    "econnreset",
    "etimedout",
  ].some((fragment) => message.includes(fragment));
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
