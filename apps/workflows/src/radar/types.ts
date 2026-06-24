export const RADAR_PROBE_PROMPT = "Reply with exactly: ok";

export const radarProbeErrorTypes = [
  "auth_error",
  "rate_limited",
  "insufficient_quota",
  "model_not_found",
  "timeout",
  "server_error",
  "network_error",
  "bad_response",
  "empty_stream",
  "unknown",
] as const;

export type RadarProbeErrorType = (typeof radarProbeErrorTypes)[number];

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
};

export type RadarTargetStatus =
  | "operational"
  | "degraded"
  | "down"
  | "configuration_error"
  | "unknown";

export type OpenAICompatibleProbeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  stream?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  fetch?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
};
