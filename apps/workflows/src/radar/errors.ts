import type { RadarProbeErrorType } from "./types";

type ClassifyFailureInput = {
  httpStatus?: number;
  bodyText?: string;
  error?: unknown;
};

const TOKEN_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9_-]{8,}/gi,
  /(api[_-]?key|x-api-key|authorization)\s*[:=]\s*["']?[^"',\s}]+/gi,
  /[A-Za-z0-9_-]{48,}/g,
];

export function redactProbeSummary(value: unknown, maxLength = 240) {
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

export function classifyProbeFailure(
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
    text.includes("insufficient_balance") ||
    text.includes("billing") ||
    text.includes("insufficient balance") ||
    text.includes("insufficient account balance") ||
    text.includes("account balance insufficient") ||
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

export function isConfigurationProbeError(errorType?: RadarProbeErrorType) {
  return (
    errorType === "auth_error" ||
    errorType === "insufficient_quota" ||
    errorType === "model_not_found"
  );
}

function isTimeoutError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}
