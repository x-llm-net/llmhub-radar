import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import {
  radarBaseUrlVisibility,
  radarClaimApplicationStatuses,
  radarEndpointTypes,
  radarErrorTypes,
  radarNotificationDeliveryStatuses,
  radarNotificationEventTypes,
  radarNotificationSeverities,
  radarOrderStatuses,
  radarOrderTypes,
  radarPoolVisibility,
  radarProviderTypes,
  radarTargetStatuses,
  radarVerificationApplicationStatuses,
  radarVerificationApplicationTypes,
  radarVerificationStatuses,
} from "./constants";
import {
  radarAccount,
  radarClaimApplication,
  radarCredential,
  radarNotificationEvent,
  radarOrder,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
  radarTargetOpenStatusBinding,
  radarTargetStatus,
  radarVerificationApplication,
} from "./radar";

export const radarPoolVisibilitySchema = z.enum(radarPoolVisibility);
export const radarVerificationStatusSchema = z.enum(radarVerificationStatuses);
export const radarVerificationApplicationTypeSchema = z.enum(
  radarVerificationApplicationTypes,
);
export const radarVerificationApplicationStatusSchema = z.enum(
  radarVerificationApplicationStatuses,
);
export const radarClaimApplicationStatusSchema = z.enum(
  radarClaimApplicationStatuses,
);
export const radarOrderTypeSchema = z.enum(radarOrderTypes);
export const radarOrderStatusSchema = z.enum(radarOrderStatuses);
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

export const selectRadarAccountSchema = createSelectSchema(radarAccount, {
  verificationStatus: radarVerificationStatusSchema.prefault("unverified"),
});

export const selectRadarVerificationApplicationSchema = createSelectSchema(
  radarVerificationApplication,
  {
    type: radarVerificationApplicationTypeSchema,
    status: radarVerificationApplicationStatusSchema.prefault("pending"),
  },
);

export const selectRadarClaimApplicationSchema = createSelectSchema(
  radarClaimApplication,
  {
    status: radarClaimApplicationStatusSchema.prefault("pending"),
  },
);

export const selectRadarOrderSchema = createSelectSchema(radarOrder, {
  type: radarOrderTypeSchema,
  status: radarOrderStatusSchema.prefault("pending_payment"),
});

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

export type RadarAccount = z.infer<typeof selectRadarAccountSchema>;
export type RadarVerificationApplication = z.infer<
  typeof selectRadarVerificationApplicationSchema
>;
export type RadarClaimApplication = z.infer<
  typeof selectRadarClaimApplicationSchema
>;
export type RadarOrder = z.infer<typeof selectRadarOrderSchema>;
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
