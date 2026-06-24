import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import {
  radarBaseUrlVisibility,
  radarEndpointTypes,
  radarErrorTypes,
  radarNotificationDeliveryStatuses,
  radarNotificationEventTypes,
  radarNotificationSeverities,
  radarPoolVisibility,
  radarProviderTypes,
  radarTargetStatuses,
} from "./constants";
import {
  radarCredential,
  radarNotificationEvent,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
  radarTargetOpenStatusBinding,
  radarTargetStatus,
} from "./radar";

export const radarPoolVisibilitySchema = z.enum(radarPoolVisibility);
export const radarProviderTypeSchema = z.enum(radarProviderTypes);
export const radarBaseUrlVisibilitySchema = z.enum(radarBaseUrlVisibility);
export const radarEndpointTypeSchema = z.enum(radarEndpointTypes);
export const radarTargetStatusSchema = z.enum(radarTargetStatuses);
export const radarErrorTypeSchema = z.enum(radarErrorTypes);
export const radarNotificationEventTypeSchema = z.enum(
  radarNotificationEventTypes,
);
export const radarNotificationSeveritySchema = z.enum(
  radarNotificationSeverities,
);
export const radarNotificationDeliveryStatusSchema = z.enum(
  radarNotificationDeliveryStatuses,
);

export const selectRadarPoolSchema = createSelectSchema(radarPool, {
  visibility: radarPoolVisibilitySchema.prefault("private"),
});

export const selectRadarProviderSchema = createSelectSchema(radarProvider, {
  baseUrlVisibility: radarBaseUrlVisibilitySchema.prefault("hidden"),
  providerType: radarProviderTypeSchema.prefault("openai_compatible"),
});

export const selectRadarCredentialSchema = createSelectSchema(radarCredential);

export const selectRadarProbeTargetSchema = createSelectSchema(
  radarProbeTarget,
  {
    endpointType: radarEndpointTypeSchema.prefault("chat_completions"),
    currentStatus: radarTargetStatusSchema.prefault("unknown"),
  },
);

export const selectRadarProbeRunSchema = createSelectSchema(radarProbeRun, {
  errorType: radarErrorTypeSchema.nullish(),
});

export const selectRadarTargetStatusSchema = createSelectSchema(
  radarTargetStatus,
  {
    currentStatus: radarTargetStatusSchema.prefault("unknown"),
  },
);

export const selectRadarTargetOpenStatusBindingSchema = createSelectSchema(
  radarTargetOpenStatusBinding,
);

export const selectRadarNotificationEventSchema = createSelectSchema(
  radarNotificationEvent,
  {
    eventType: radarNotificationEventTypeSchema,
    severity: radarNotificationSeveritySchema,
    previousStatus: radarTargetStatusSchema.nullish(),
    currentStatus: radarTargetStatusSchema,
    status: radarNotificationDeliveryStatusSchema.prefault("pending"),
  },
);

export type RadarPool = z.infer<typeof selectRadarPoolSchema>;
export type RadarProvider = z.infer<typeof selectRadarProviderSchema>;
export type RadarCredential = z.infer<typeof selectRadarCredentialSchema>;
export type RadarProbeTarget = z.infer<typeof selectRadarProbeTargetSchema>;
export type RadarProbeRun = z.infer<typeof selectRadarProbeRunSchema>;
export type RadarTargetStatus = z.infer<typeof selectRadarTargetStatusSchema>;
export type RadarTargetOpenStatusBinding = z.infer<
  typeof selectRadarTargetOpenStatusBindingSchema
>;
export type RadarNotificationEvent = z.infer<
  typeof selectRadarNotificationEventSchema
>;
