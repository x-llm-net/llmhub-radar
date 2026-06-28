import {
  radarBaseUrlVisibility,
  radarEndpointTypes,
  radarErrorTypes,
  radarPoolVisibility,
  radarProviderTypes,
  radarTargetStatuses,
} from "@openstatus/db/src/schema";
import { z } from "zod";

export const radarSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only.")
  .min(3)
  .max(80);

export const CreateRadarPoolInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: radarSlugSchema,
    description: z.string().trim().max(500).optional().default(""),
    visibility: z.enum(radarPoolVisibility).optional().default("unlisted"),
    publicPoolOptIn: z.boolean().optional().default(false),
    provider: z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        displayName: z.string().trim().min(1).max(120),
        baseUrl: z.string().trim().url(),
        baseUrlVisibility: z
          .enum(radarBaseUrlVisibility)
          .optional()
          .default("hidden"),
        providerType: z
          .enum(radarProviderTypes)
          .optional()
          .default("openai_compatible"),
      })
      .optional(),
    credential: z
      .object({
        name: z.string().trim().min(1).max(120).default("API key"),
        apiKey: z.string().trim().min(8).max(4096),
        billingGroup: z.string().trim().max(120).optional().default(""),
        modelGroup: z.string().trim().max(120).optional().default(""),
        modelCatalog: z
          .array(z.string().trim().min(1).max(160))
          .max(200)
          .transform((models) => Array.from(new Set(models)))
          .optional()
          .default([]),
      })
      .optional(),
    targetName: z.string().trim().min(1).max(160).optional(),
    probeModel: z.string().trim().min(1).max(160).optional(),
    models: z
      .array(z.string().trim().min(1).max(160))
      .max(50)
      .transform((models) => Array.from(new Set(models)))
      .optional()
      .default([]),
  })
  .superRefine((input, ctx) => {
    const hasInitialTarget =
      Boolean(input.probeModel) || input.models.length > 0;

    if (!input.provider && (input.credential || hasInitialTarget)) {
      ctx.addIssue({
        code: "custom",
        message: "Provider is required when creating credentials or targets.",
        path: ["provider"],
      });
    }
    if (hasInitialTarget && !input.credential) {
      ctx.addIssue({
        code: "custom",
        message: "Credential is required when creating initial targets.",
        path: ["credential"],
      });
    }
  });
export type CreateRadarPoolInput = z.infer<typeof CreateRadarPoolInput>;

export const ListRadarPoolsInput = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .default({ limit: 50, offset: 0 });
export type ListRadarPoolsInput = z.infer<typeof ListRadarPoolsInput>;

export const GetRadarPoolInput = z.object({
  slug: radarSlugSchema,
});
export type GetRadarPoolInput = z.infer<typeof GetRadarPoolInput>;

export const UpdateRadarPoolInput = z.object({
  currentSlug: radarSlugSchema,
  name: z.string().trim().min(1).max(120),
  slug: radarSlugSchema,
  description: z.string().trim().max(500).optional().default(""),
  baseUrl: z.string().trim().url(),
  publicPoolOptIn: z.boolean().optional().default(false),
});
export type UpdateRadarPoolInput = z.infer<typeof UpdateRadarPoolInput>;

export const DiscoverRadarModelsInput = z.object({
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(8).max(4096),
});
export type DiscoverRadarModelsInput = z.infer<typeof DiscoverRadarModelsInput>;

export const DiscoverRadarModelsForPoolInput = z.object({
  poolSlug: radarSlugSchema,
  apiKey: z.string().trim().min(8).max(4096),
});
export type DiscoverRadarModelsForPoolInput = z.infer<
  typeof DiscoverRadarModelsForPoolInput
>;

export const CreateRadarProviderInput = z.object({
  poolId: z.number().int(),
  name: z.string().trim().min(1).max(120).optional(),
  displayName: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url(),
  baseUrlVisibility: z
    .enum(radarBaseUrlVisibility)
    .optional()
    .default("hidden"),
  providerType: z
    .enum(radarProviderTypes)
    .optional()
    .default("openai_compatible"),
  enabled: z.boolean().optional().default(true),
  notes: z.string().trim().max(1000).optional().default(""),
});
export type CreateRadarProviderInput = z.infer<typeof CreateRadarProviderInput>;

export const CreateRadarCredentialInput = z.object({
  providerId: z.number().int(),
  name: z.string().trim().min(1).max(120).default("API key"),
  description: z.string().trim().max(500).optional().default(""),
  apiKey: z.string().trim().min(8).max(4096),
  billingGroup: z.string().trim().max(120).optional().default(""),
  modelGroup: z.string().trim().max(120).optional().default(""),
  modelCatalog: z
    .array(z.string().trim().min(1).max(160))
    .max(200)
    .transform((models) => Array.from(new Set(models)))
    .optional()
    .default([]),
  dailyProbeLimit: z.number().int().positive().optional().default(288),
  dailyTokenLimit: z.number().int().positive().optional().default(2000),
  dailyCostLimitCents: z.number().int().nonnegative().optional().default(100),
  enabled: z.boolean().optional().default(true),
});
export type CreateRadarCredentialInput = z.infer<
  typeof CreateRadarCredentialInput
>;

export const CreateRadarTargetInput = z.object({
  poolId: z.number().int(),
  providerId: z.number().int(),
  credentialId: z.number().int().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  modelName: z.string().trim().min(1).max(160),
  endpointType: z
    .enum(radarEndpointTypes)
    .optional()
    .default("chat_completions"),
  intervalSeconds: z.number().int().min(60).max(86_400).optional().default(600),
  timeoutMs: z.number().int().min(1_000).max(60_000).optional().default(20_000),
  maxTokens: z.number().int().min(1).max(64).optional().default(1),
  streamEnabled: z.boolean().optional().default(true),
  enabled: z.boolean().optional().default(true),
  statusPolicy: z.record(z.string(), z.unknown()).optional(),
});
export type CreateRadarTargetInput = z.infer<typeof CreateRadarTargetInput>;

export const AddRadarTokenProbeInput = z.object({
  poolSlug: radarSlugSchema,
  apiKeyName: z.string().trim().min(1).max(120),
  modelType: z.string().trim().min(1).max(120).default("General"),
  apiKey: z.string().trim().min(8).max(4096),
  probeModel: z.string().trim().min(1).max(160),
  availableModels: z
    .array(z.string().trim().min(1).max(160))
    .max(200)
    .transform((models) => Array.from(new Set(models)))
    .optional()
    .default([]),
  intervalSeconds: z.number().int().min(60).max(86_400).optional().default(600),
  timeoutMs: z.number().int().min(1_000).max(60_000).optional().default(20_000),
  maxTokens: z.number().int().min(1).max(64).optional().default(1),
  streamEnabled: z.boolean().optional().default(true),
});
export type AddRadarTokenProbeInput = z.infer<typeof AddRadarTokenProbeInput>;

export const UpdateRadarTokenProbeInput = z.object({
  poolSlug: radarSlugSchema,
  credentialId: z.number().int().positive(),
  apiKeyName: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(8).max(4096).optional(),
  modelType: z.string().trim().min(1).max(120).default("General"),
  probeModel: z.string().trim().min(1).max(160),
  availableModels: z
    .array(z.string().trim().min(1).max(160))
    .max(200)
    .transform((models) => Array.from(new Set(models)))
    .optional()
    .default([]),
});
export type UpdateRadarTokenProbeInput = z.infer<
  typeof UpdateRadarTokenProbeInput
>;

export const DeleteRadarCredentialInput = z.object({
  poolSlug: radarSlugSchema,
  credentialId: z.number().int().positive(),
});
export type DeleteRadarCredentialInput = z.infer<
  typeof DeleteRadarCredentialInput
>;

export const RecordRadarProbeRunInput = z.object({
  targetId: z.number().int(),
  startedAt: z.date(),
  finishedAt: z.date().optional(),
  success: z.boolean(),
  httpStatus: z.number().int().optional(),
  errorType: z.enum(radarErrorTypes).optional(),
  safeErrorSummary: z.string().max(500).optional(),
  ttfbMs: z.number().int().optional(),
  firstTokenMs: z.number().int().optional(),
  totalLatencyMs: z.number().int().optional(),
  tokensIn: z.number().int().optional(),
  tokensOut: z.number().int().optional(),
  tokensPerSecond: z.number().int().optional(),
  estimatedCostMicros: z.number().int().optional(),
  responseSampleHash: z.string().max(128).optional(),
  traceId: z.string().max(128).optional(),
});
export type RecordRadarProbeRunInput = z.infer<typeof RecordRadarProbeRunInput>;

export const RadarProbeTargetInput = z.object({
  id: z.number().int(),
  endpointType: z.enum(radarEndpointTypes),
});
export type RadarProbeTargetInput = z.infer<typeof RadarProbeTargetInput>;

export const ListRadarRecentRunsInput = z.object({
  poolId: z.number().int().optional(),
  targetId: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListRadarRecentRunsInput = z.infer<typeof ListRadarRecentRunsInput>;

export const ListRadarStatusInput = z.object({
  poolId: z.number().int().optional(),
  targetId: z.number().int().optional(),
  status: z.enum(radarTargetStatuses).optional(),
});
export type ListRadarStatusInput = z.infer<typeof ListRadarStatusInput>;
