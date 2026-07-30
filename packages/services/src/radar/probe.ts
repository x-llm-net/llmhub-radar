import { createHash } from "node:crypto";

import type { radarErrorTypes } from "@openstatus/db/src/schema";

export const RADAR_PROBE_PROMPT = "hi";

export type RadarProbeErrorType = (typeof radarErrorTypes)[number];

export type RadarProbeResult = {
  success: boolean;
  httpStatus?: number;
  errorType?: RadarProbeErrorType;
  ttfbMs?: number;
  firstTokenMs?: number;
  totalLatencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  safeErrorSummary?: string;
  responseSampleHash?: string;
};

export type OpenAICompatibleProbeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  stream?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  fetch?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
};

type UrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

type ClassifyFailureInput = {
  httpStatus?: number;
  bodyText?: string;
  error?: unknown;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 1;
const MAX_PROBE_TOKENS = 1;

const TOKEN_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9_-]{8,}/gi,
  /(api[_-]?key|x-api-key|authorization)\s*[:=]\s*["']?[^"',\s}]+/gi,
  /[A-Za-z0-9_-]{48,}/g,
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "ip6-localhost",
  "metadata.google.internal",
]);

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan"];

export async function runOpenAICompatibleProbe(
  config: OpenAICompatibleProbeConfig,
): Promise<RadarProbeResult> {
  const startedAt = performance.now();
  const validatedUrl = validateProbeBaseUrl(config.baseUrl);

  if (!validatedUrl.ok) {
    return {
      success: false,
      errorType: "bad_response",
      totalLatencyMs: elapsedMs(startedAt),
      safeErrorSummary: `Blocked unsafe probe URL: ${validatedUrl.reason}`,
    };
  }

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const doFetch = config.fetch ?? fetch;
  const stream = config.stream ?? true;

  try {
    const response = await doFetch(buildChatCompletionsUrl(validatedUrl.url), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        pragma: "no-cache",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: RADAR_PROBE_PROMPT }],
        temperature: 0,
        max_tokens: clampMaxTokens(config.maxTokens),
        stream,
      }),
    });

    const ttfbMs = elapsedMs(startedAt);

    if (!response.ok) {
      const bodyText = await readTextSafely(response);
      const errorType = classifyProbeFailure({
        httpStatus: response.status,
        bodyText,
      });

      return {
        success: false,
        httpStatus: response.status,
        errorType,
        ttfbMs,
        totalLatencyMs: elapsedMs(startedAt),
        safeErrorSummary: summarizeHttpError(
          response.status,
          errorType,
          bodyText,
        ),
      };
    }

    if (stream) {
      return await parseStreamingProbeResponse(response, startedAt, ttfbMs);
    }

    return await parseJsonProbeResponse(response, startedAt, ttfbMs);
  } catch (error) {
    const errorType = classifyProbeFailure({ error });

    return {
      success: false,
      errorType,
      totalLatencyMs: elapsedMs(startedAt),
      safeErrorSummary: redactProbeSummary(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function validateProbeBaseUrl(input: string): UrlValidationResult {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (!hostname) {
    return { ok: false, reason: "missing_host" };
  }

  if (BLOCKED_HOSTS.has(hostname) || hostname === "0.0.0.0") {
    return { ok: false, reason: "blocked_host" };
  }

  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: "private_host" };
  }

  if (!hostname.includes(".") && hostname !== "localhost") {
    return { ok: false, reason: "private_host" };
  }

  if (isRawIpAddress(hostname)) {
    return { ok: false, reason: "raw_ip_blocked" };
  }

  return { ok: true, url };
}

function buildChatCompletionsUrl(baseUrl: URL) {
  const url = new URL(baseUrl.toString());
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/chat/completions")) {
    return url;
  }

  if (pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/chat/completions`;
    return url;
  }

  url.pathname = `${pathname}/v1/chat/completions`.replace(/\/{2,}/g, "/");
  return url;
}

function classifyProbeFailure(
  input: ClassifyFailureInput,
): RadarProbeErrorType {
  const text = redactProbeSummary(
    `${input.bodyText ?? ""} ${
      input.error instanceof Error
        ? input.error.message
        : String(input.error ?? "")
    }`,
  ).toLowerCase();

  if (isTimeoutError(input.error) || text.includes("timeout")) {
    return "timeout";
  }

  if (
    text.includes("insufficient_quota") ||
    text.includes("insufficient quota") ||
    text.includes("quota exceeded") ||
    text.includes("exceeded your current quota") ||
    text.includes("billing") ||
    text.includes("insufficient balance") ||
    text.includes("not enough balance") ||
    text.includes("no balance") ||
    text.includes("balance is 0") ||
    text.includes("balance exhausted") ||
    text.includes("insufficient credit") ||
    text.includes("not enough credit") ||
    text.includes("no credit") ||
    text.includes("credits exhausted") ||
    text.includes("recharge") ||
    text.includes("top up") ||
    text.includes("余额不足") ||
    text.includes("余额为0") ||
    text.includes("余额为 0") ||
    text.includes("可用余额") ||
    text.includes("额度不足") ||
    text.includes("欠费") ||
    text.includes("充值")
  ) {
    return "insufficient_quota";
  }

  if (
    text.includes("model_not_found") ||
    text.includes("model not found") ||
    text.includes("does not exist") ||
    text.includes("invalid model") ||
    text.includes("model is not available")
  ) {
    return "model_not_found";
  }

  if (
    input.httpStatus === 401 ||
    input.httpStatus === 403 ||
    text.includes("invalid api key") ||
    text.includes("incorrect api key") ||
    text.includes("unauthorized") ||
    text.includes("forbidden")
  ) {
    return "auth_error";
  }

  if (input.httpStatus === 429 || text.includes("rate limit")) {
    return "rate_limited";
  }

  if (typeof input.httpStatus === "number" && input.httpStatus >= 500) {
    return "server_error";
  }

  if (input.error) {
    return "network_error";
  }

  return "unknown";
}

function redactProbeSummary(value: unknown, maxLength = 240) {
  const raw =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : JSON.stringify(value);

  let summary = raw.replace(/\s+/g, " ").trim();

  for (const pattern of TOKEN_PATTERNS) {
    summary = summary.replace(pattern, "[redacted]");
  }

  if (summary.length > maxLength) {
    return `${summary.slice(0, maxLength - 3)}...`;
  }

  return summary;
}

function clampMaxTokens(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_TOKENS;
  }

  return Math.min(MAX_PROBE_TOKENS, Math.max(1, Math.floor(value)));
}

async function parseJsonProbeResponse(
  response: Response,
  startedAt: number,
  ttfbMs: number,
): Promise<RadarProbeResult> {
  let json: unknown;

  try {
    json = await response.json();
  } catch (error) {
    return {
      success: false,
      httpStatus: response.status,
      errorType: "bad_response",
      ttfbMs,
      totalLatencyMs: elapsedMs(startedAt),
      safeErrorSummary: redactProbeSummary(error),
    };
  }

  const content = extractChatContent(json);
  const usage = extractUsage(json);

  if (!hasProbeOutput(content)) {
    return {
      success: false,
      httpStatus: response.status,
      errorType: "bad_response",
      ttfbMs,
      totalLatencyMs: elapsedMs(startedAt),
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      responseSampleHash: hashSample(content),
      safeErrorSummary: "Probe response did not contain text",
    };
  }

  return {
    success: true,
    httpStatus: response.status,
    ttfbMs,
    totalLatencyMs: elapsedMs(startedAt),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    responseSampleHash: hashSample(content),
  };
}

async function parseStreamingProbeResponse(
  response: Response,
  startedAt: number,
  ttfbMs: number,
): Promise<RadarProbeResult> {
  if (!response.body) {
    return {
      success: false,
      httpStatus: response.status,
      errorType: "empty_stream",
      ttfbMs,
      totalLatencyMs: elapsedMs(startedAt),
      safeErrorSummary: "Streaming response had no readable body",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let firstTokenMs: number | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.remaining;

      for (const event of parsed.events) {
        const data = parseSseData(event);

        for (const item of data) {
          if (item === "[DONE]") {
            continue;
          }

          const chunk = parseJsonChunk(item);

          if (!chunk.ok) {
            return {
              success: false,
              httpStatus: response.status,
              errorType: "bad_response",
              ttfbMs,
              firstTokenMs,
              totalLatencyMs: elapsedMs(startedAt),
              safeErrorSummary: chunk.summary,
            };
          }

          const delta = extractStreamContent(chunk.value);
          const usage = extractUsage(chunk.value);

          if (typeof usage.tokensIn === "number") {
            tokensIn = usage.tokensIn;
          }
          if (typeof usage.tokensOut === "number") {
            tokensOut = usage.tokensOut;
          }

          if (delta) {
            content += delta;
            firstTokenMs ??= elapsedMs(startedAt);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!content) {
    return {
      success: false,
      httpStatus: response.status,
      errorType: "empty_stream",
      ttfbMs,
      totalLatencyMs: elapsedMs(startedAt),
      safeErrorSummary: "Streaming response completed without content",
    };
  }

  return {
    success: true,
    httpStatus: response.status,
    ttfbMs,
    firstTokenMs,
    totalLatencyMs: elapsedMs(startedAt),
    tokensIn,
    tokensOut,
    responseSampleHash: hashSample(content),
  };
}

async function readTextSafely(response: Response) {
  try {
    return await response.text();
  } catch (error) {
    return redactProbeSummary(error);
  }
}

function summarizeHttpError(
  httpStatus: number,
  errorType: string,
  bodyText: string,
) {
  const body = redactProbeSummary(bodyText);

  if (!body) {
    return `HTTP ${httpStatus}: ${errorType}`;
  }

  return `HTTP ${httpStatus}: ${errorType}: ${body}`;
}

function parseSseEvents(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remaining = parts.pop() ?? "";

  return {
    events: parts.filter(Boolean),
    remaining,
  };
}

function parseSseData(event: string) {
  return event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);
}

function parseJsonChunk(
  input: string,
): { ok: true; value: unknown } | { ok: false; summary: string } {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return {
      ok: false,
      summary: "Streaming response contained invalid JSON",
    };
  }
}

function extractChatContent(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  const choices = value.choices;

  if (!Array.isArray(choices)) {
    return "";
  }

  return choices
    .map((choice) => {
      if (!isRecord(choice) || !isRecord(choice.message)) {
        return "";
      }

      return typeof choice.message.content === "string"
        ? choice.message.content
        : "";
    })
    .join("");
}

function extractStreamContent(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  const choices = value.choices;

  if (!Array.isArray(choices)) {
    return "";
  }

  return choices
    .map((choice) => {
      if (!isRecord(choice)) {
        return "";
      }

      if (isRecord(choice.delta) && typeof choice.delta.content === "string") {
        return choice.delta.content;
      }

      if (
        isRecord(choice.message) &&
        typeof choice.message.content === "string"
      ) {
        return choice.message.content;
      }

      return "";
    })
    .join("");
}

function extractUsage(value: unknown) {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return {};
  }

  return {
    tokensIn:
      typeof value.usage.prompt_tokens === "number"
        ? value.usage.prompt_tokens
        : undefined,
    tokensOut:
      typeof value.usage.completion_tokens === "number"
        ? value.usage.completion_tokens
        : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRawIpAddress(hostname: string) {
  return isIpv4Address(hostname) || hostname.includes(":");
}

function isIpv4Address(hostname: string) {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isTimeoutError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function hasProbeOutput(value: string) {
  return value.trim().length > 0;
}

function hashSample(value: string) {
  if (!value) {
    return undefined;
  }

  return createHash("sha256").update(value).digest("base64url").slice(0, 64);
}
