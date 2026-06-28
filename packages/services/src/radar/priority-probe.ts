import {
  type OpenAICompatibleProbeConfig,
  runOpenAICompatibleProbe,
  type RadarProbeResult,
} from "./probe";

const DEFAULT_PRIORITY_PROBE_RETRIES = 1;
const DEFAULT_PRIORITY_PROBE_RETRY_BACKOFF_MS = 1_500;
const MAX_PRIORITY_PROBE_RETRIES = 2;
const MAX_PRIORITY_PROBE_RETRY_BACKOFF_MS = 30_000;

type EnvLike = Record<string, string | undefined>;
type ProbeFn = (
  config: OpenAICompatibleProbeConfig,
) => Promise<RadarProbeResult>;

export function getPriorityProbeConfig(
  poolSlug: string,
  env: EnvLike = process.env,
) {
  const runtimeConfig = getPriorityProbeRuntimeConfig(env);

  return {
    enabled: runtimeConfig.poolSlugs.has(poolSlug.trim().toLowerCase()),
    retryAttempts: runtimeConfig.retryAttempts,
    retryBackoffMs: runtimeConfig.retryBackoffMs,
  };
}

export function getPriorityProbeRuntimeConfig(env: EnvLike = process.env) {
  return {
    poolSlugs: parsePriorityPoolSlugs(env.RADAR_PRIORITY_POOL_SLUGS),
    retryAttempts: parseBoundedNonNegativeInt({
      value: env.RADAR_PRIORITY_PROBE_RETRIES,
      fallback: DEFAULT_PRIORITY_PROBE_RETRIES,
      max: MAX_PRIORITY_PROBE_RETRIES,
    }),
    retryBackoffMs: parseBoundedNonNegativeInt({
      value: env.RADAR_PRIORITY_PROBE_RETRY_BACKOFF_MS,
      fallback: DEFAULT_PRIORITY_PROBE_RETRY_BACKOFF_MS,
      max: MAX_PRIORITY_PROBE_RETRY_BACKOFF_MS,
    }),
  };
}

export async function runProbeWithOptionalRetry(
  args: OpenAICompatibleProbeConfig & {
    retryAttempts: number;
    retryBackoffMs: number;
    probe?: ProbeFn;
    sleepFn?: (ms: number) => Promise<void>;
  },
) {
  const {
    retryAttempts,
    retryBackoffMs,
    probe = runOpenAICompatibleProbe,
    sleepFn = sleep,
    ...probeConfig
  } = args;
  const attempts = clampNonNegativeInt(
    retryAttempts,
    MAX_PRIORITY_PROBE_RETRIES,
  );
  const backoffMs = clampNonNegativeInt(
    retryBackoffMs,
    MAX_PRIORITY_PROBE_RETRY_BACKOFF_MS,
  );
  let elapsedBeforeAttempt = 0;

  for (let attempt = 0; ; attempt += 1) {
    const rawResult = await probe(probeConfig);
    const result = offsetProbeTiming(rawResult, elapsedBeforeAttempt);

    if (attempt >= attempts || !isRetryableProbeResult(rawResult)) {
      return result;
    }

    elapsedBeforeAttempt += Math.max(0, rawResult.totalLatencyMs) + backoffMs;
    await sleepFn(backoffMs);
  }
}

export function isRetryableProbeResult(result: RadarProbeResult) {
  if (result.success) return false;

  return (
    result.errorType === "timeout" ||
    result.errorType === "network_error" ||
    result.errorType === "server_error"
  );
}

export function parsePriorityPoolSlugs(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function offsetProbeTiming(
  result: RadarProbeResult,
  offsetMs: number,
): RadarProbeResult {
  if (offsetMs <= 0) return result;

  return {
    ...result,
    ttfbMs: addOffset(result.ttfbMs, offsetMs),
    firstTokenMs: addOffset(result.firstTokenMs, offsetMs),
    totalLatencyMs: result.totalLatencyMs + offsetMs,
  };
}

function addOffset(value: number | undefined, offsetMs: number) {
  return typeof value === "number" ? value + offsetMs : undefined;
}

function parseBoundedNonNegativeInt(args: {
  value: string | undefined;
  fallback: number;
  max: number;
}) {
  if (!args.value) return args.fallback;

  const parsed = Number.parseInt(args.value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return args.fallback;

  return Math.min(parsed, args.max);
}

function clampNonNegativeInt(value: number, max: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
