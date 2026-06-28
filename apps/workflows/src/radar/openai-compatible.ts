import { classifyProbeFailure, redactProbeSummary } from "./errors";
import { buildChatCompletionsUrl, validateProbeBaseUrl } from "./ssrf";
import {
  RADAR_PROBE_PROMPT,
  type OpenAICompatibleProbeConfig,
  type RadarProbeResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 1;
const MAX_PROBE_TOKENS = 1;

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

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function hasProbeOutput(value: string) {
  return value.trim().length > 0;
}
