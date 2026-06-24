import type {
  radarNotificationEventTypes,
  radarTargetStatuses,
} from "@openstatus/db/src/schema";

export type RadarTargetStatus = (typeof radarTargetStatuses)[number];
export type RadarNotificationEventType =
  (typeof radarNotificationEventTypes)[number];
export type RadarNotificationSeverity = "info" | "warning" | "critical";

const ACTIVE_PROBLEM_EVENTS: RadarNotificationEventType[] = [
  "degraded",
  "down",
  "configuration_error",
];

export function decideRadarNotificationEvent(args: {
  previousStatus?: RadarTargetStatus | null;
  currentStatus: RadarTargetStatus;
  latestEventType?: RadarNotificationEventType | null;
}): RadarNotificationEventType | null {
  const { previousStatus, currentStatus, latestEventType } = args;

  if (
    currentStatus === "operational" &&
    previousStatus &&
    ["degraded", "down", "configuration_error"].includes(previousStatus)
  ) {
    return latestEventType === "recovered" ? null : "recovered";
  }

  if (currentStatus === "down") {
    if (previousStatus === "down" || latestEventType === "down") return null;
    return "down";
  }

  if (currentStatus === "configuration_error") {
    if (
      previousStatus === "configuration_error" ||
      latestEventType === "configuration_error"
    ) {
      return null;
    }
    return "configuration_error";
  }

  if (currentStatus === "degraded") {
    if (previousStatus !== "degraded") return null;
    if (latestEventType && ACTIVE_PROBLEM_EVENTS.includes(latestEventType)) {
      return null;
    }
    return "degraded";
  }

  return null;
}

export function severityForRadarEvent(
  eventType: RadarNotificationEventType,
): RadarNotificationSeverity {
  switch (eventType) {
    case "down":
    case "configuration_error":
      return "critical";
    case "degraded":
      return "warning";
    case "recovered":
      return "info";
  }
}
