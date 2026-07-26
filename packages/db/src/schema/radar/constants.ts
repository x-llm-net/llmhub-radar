export const radarPoolVisibility = ["private", "unlisted", "public"] as const;

export const radarVerificationStatuses = [
  "unverified",
  "pending",
  "verified",
  "rejected",
] as const;

export const radarVerificationApplicationTypes = [
  "personal",
  "enterprise",
] as const;

export const radarVerificationApplicationStatuses = [
  "pending",
  "approved",
  "rejected",
] as const;

export const radarClaimApplicationStatuses = [
  "pending",
  "approved",
  "rejected",
] as const;

export const radarOrderTypes = [
  "permanent_listing",
  "sponsored_slot",
  "pro_subscription",
] as const;

export const radarOrderStatuses = [
  "pending_payment",
  "pending_review",
  "paid",
  "active",
  "rejected",
  "cancelled",
  "refunded",
] as const;

export const radarProviderTypes = [
  "openai_compatible",
  "anthropic_compatible",
  "custom",
] as const;

export const radarBaseUrlVisibility = ["hidden", "masked", "public"] as const;

export const radarEndpointTypes = ["chat_completions"] as const;

export const radarTargetStatuses = [
  "unknown",
  "operational",
  "degraded",
  "down",
  "paused",
  "configuration_error",
] as const;

export const radarNotificationEventTypes = [
  "degraded",
  "down",
  "configuration_error",
  "recovered",
] as const;

export const radarNotificationSeverities = [
  "info",
  "warning",
  "critical",
] as const;

export const radarNotificationDeliveryStatuses = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;

export const radarErrorTypes = [
  "auth_error",
  "rate_limited",
  "insufficient_quota",
  "model_not_found",
  "timeout",
  "server_error",
  "network_error",
  "bad_response",
  "empty_stream",
  "content_filter",
  "unknown",
] as const;
