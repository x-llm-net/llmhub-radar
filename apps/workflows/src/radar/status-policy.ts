import {
  isConfigurationProbeError,
} from "./errors";
import type {
  RadarProbeErrorType,
  RadarProbeResult,
  RadarTargetStatus,
} from "./types";

type StatusPolicyInput = {
  recentResults: Pick<
    RadarProbeResult,
    "success" | "errorType" | "firstTokenMs" | "totalLatencyMs"
  >[];
  previousStatus?: RadarTargetStatus;
  failureThreshold?: number;
  recoveryThreshold?: number;
  slowFirstTokenMs?: number;
  slowTotalLatencyMs?: number;
};

export function evaluateRadarTargetStatus(
  input: StatusPolicyInput,
): RadarTargetStatus {
  const {
    recentResults,
    previousStatus,
    failureThreshold = 3,
    recoveryThreshold = 2,
    slowFirstTokenMs = 10_000,
    slowTotalLatencyMs = 30_000,
  } = input;

  const latest = recentResults.at(-1);

  if (!latest) {
    return "unknown";
  }

  const consecutiveFailures = countTrailing(recentResults, (result) => {
    return !result.success;
  });
  const consecutiveSuccesses = countTrailing(recentResults, (result) => {
    return result.success;
  });

  if (!latest.success) {
    const latestErrorType = latest.errorType;

    if (isConfigurationProbeError(latestErrorType)) {
      return "configuration_error";
    }

    if (consecutiveFailures >= failureThreshold) {
      return "down";
    }

    return "degraded";
  }

  if (isSlowProbe(latest, slowFirstTokenMs, slowTotalLatencyMs)) {
    return "degraded";
  }

  if (consecutiveSuccesses >= recoveryThreshold) {
    return "operational";
  }

  if (previousStatus && previousStatus !== "unknown") {
    return "degraded";
  }

  return "unknown";
}

export function isFailureLikelyConfiguration(
  errorType?: RadarProbeErrorType,
) {
  return isConfigurationProbeError(errorType);
}

function countTrailing<T>(items: T[], predicate: (item: T) => boolean) {
  let count = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!predicate(items[index])) {
      break;
    }

    count += 1;
  }

  return count;
}

function isSlowProbe(
  result: Pick<RadarProbeResult, "firstTokenMs" | "totalLatencyMs">,
  slowFirstTokenMs: number,
  slowTotalLatencyMs: number,
) {
  if (
    typeof result.firstTokenMs === "number" &&
    result.firstTokenMs >= slowFirstTokenMs
  ) {
    return true;
  }

  return result.totalLatencyMs >= slowTotalLatencyMs;
}
