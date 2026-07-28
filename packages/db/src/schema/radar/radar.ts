import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { mediaAsset } from "../media_assets";
import { monitor } from "../monitors";
import { pageComponent } from "../page_components";
import { page } from "../pages";
import { user } from "../users";
import { workspace } from "../workspaces";
import {
  radarBaseUrlVisibility,
  radarClaimApplicationStatuses,
  radarCredentialPauseReasons,
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

export const radarAccount = sqliteTable("radar_account", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  verificationStatus: text("verification_status", {
    enum: radarVerificationStatuses,
  })
    .default("unverified")
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const radarVerificationApplication = sqliteTable(
  "radar_verification_application",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: radarVerificationApplicationTypes,
    }).notNull(),
    status: text("status", {
      enum: radarVerificationApplicationStatuses,
    })
      .default("pending")
      .notNull(),
    realName: text("real_name", { length: 120 }),
    companyName: text("company_name", { length: 200 }),
    creditCode: text("credit_code", { length: 64 }),
    legalRepresentativeName: text("legal_representative_name", {
      length: 120,
    }),
    identityNumberEncrypted: text("identity_number_encrypted"),
    identityNumberHash: text("identity_number_hash", { length: 128 }),
    identityNumberMasked: text("identity_number_masked", { length: 32 }),
    mobileEncrypted: text("mobile_encrypted"),
    mobileHash: text("mobile_hash", { length: 128 }),
    mobileMasked: text("mobile_masked", { length: 32 }),
    // Deprecated v1 fields retained as nullable columns for a safe migration.
    contactName: text("contact_name", { length: 120 }),
    contactQq: text("contact_qq", { length: 64 }),
    websiteUrl: text("website_url", { length: 256 }),
    proof: text("proof", { length: 2000 }),
    reviewNote: text("review_note", { length: 1000 }),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    paymentConfirmedAt: integer("payment_confirmed_at", {
      mode: "timestamp",
    }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    index("radar_verification_application_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
    index("radar_verification_application_status_created_idx").on(
      t.status,
      t.createdAt,
    ),
    index("radar_verification_application_identity_hash_idx").on(
      t.identityNumberHash,
    ),
    index("radar_verification_application_credit_code_idx").on(t.creditCode),
  ],
);

export const radarPool = sqliteTable(
  "radar_pool",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    ownerUserId: integer("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    claimable: integer("claimable", { mode: "boolean" })
      .default(false)
      .notNull(),
    name: text("name", { length: 120 }).notNull(),
    slug: text("slug", { length: 80 }).notNull(),
    description: text("description", { length: 5000 }).default("").notNull(),
    pricingUrl: text("pricing_url", { length: 256 }),
    redirectUrlTemplate: text("redirect_url_template", { length: 256 }),
    contactQq: text("contact_qq", { length: 64 }),
    visibility: text("visibility", { enum: radarPoolVisibility })
      .default("private")
      .notNull(),
    publicPoolOptIn: integer("public_pool_opt_in", { mode: "boolean" })
      .default(false)
      .notNull(),
    pageId: integer("page_id").references(() => page.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("radar_pool_workspace_slug_idx").on(t.workspaceId, t.slug),
    index("radar_pool_workspace_id_idx").on(t.workspaceId),
    index("radar_pool_owner_user_id_idx").on(t.ownerUserId),
  ],
);

export const radarClaimApplication = sqliteTable(
  "radar_claim_application",
  {
    id: integer("id").primaryKey(),
    poolId: integer("pool_id")
      .notNull()
      .references(() => radarPool.id, { onDelete: "cascade" }),
    applicantUserId: integer("applicant_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    status: text("status", { enum: radarClaimApplicationStatuses })
      .default("pending")
      .notNull(),
    proof: text("proof", { length: 2000 }).notNull(),
    evidenceImageUrls: text("evidence_image_urls", { mode: "json" })
      .$type<string[]>()
      .default([])
      .notNull(),
    reviewNote: text("review_note", { length: 1000 }),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    index("radar_claim_application_pool_status_idx").on(t.poolId, t.status),
    index("radar_claim_application_applicant_status_idx").on(
      t.applicantUserId,
      t.status,
    ),
    index("radar_claim_application_created_idx").on(t.createdAt),
  ],
);

export const radarClaimApplicationEvidence = sqliteTable(
  "radar_claim_application_evidence",
  {
    applicationId: integer("application_id")
      .notNull()
      .references(() => radarClaimApplication.id, { onDelete: "cascade" }),
    assetId: text("asset_id", { length: 36 })
      .notNull()
      .references(() => mediaAsset.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.applicationId, t.assetId] }),
    index("radar_claim_evidence_application_order_idx").on(
      t.applicationId,
      t.sortOrder,
    ),
    index("radar_claim_evidence_asset_idx").on(t.assetId),
  ],
);

export const radarOrder = sqliteTable(
  "radar_order",
  {
    id: integer("id").primaryKey(),
    orderNumber: text("order_number", { length: 40 }).notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    verificationApplicationId: integer(
      "verification_application_id",
    ).references(() => radarVerificationApplication.id, {
      onDelete: "set null",
    }),
    poolId: integer("pool_id").references(() => radarPool.id, {
      onDelete: "set null",
    }),
    modelSlug: text("model_slug", { length: 160 }),
    type: text("type", { enum: radarOrderTypes }).notNull(),
    status: text("status", { enum: radarOrderStatuses })
      .default("pending_payment")
      .notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency", { length: 8 }).default("CNY").notNull(),
    receiptAssetId: text("receipt_asset_id", { length: 36 }).references(
      () => mediaAsset.id,
      { onDelete: "set null" },
    ),
    reviewNote: text("review_note", { length: 1000 }),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    activatedAt: integer("activated_at", { mode: "timestamp" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    uniqueIndex("radar_order_number_idx").on(t.orderNumber),
    uniqueIndex("radar_order_verification_application_idx").on(
      t.verificationApplicationId,
    ),
    uniqueIndex("radar_order_receipt_asset_idx").on(t.receiptAssetId),
    index("radar_order_user_created_idx").on(t.userId, t.createdAt),
    index("radar_order_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const radarProvider = sqliteTable(
  "radar_provider",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    poolId: integer("pool_id")
      .notNull()
      .references(() => radarPool.id, { onDelete: "cascade" }),
    name: text("name", { length: 120 }).notNull(),
    displayName: text("display_name", { length: 120 }).notNull(),
    baseUrlEncrypted: text("base_url_encrypted").notNull(),
    baseUrlHostHash: text("base_url_host_hash", { length: 128 }).notNull(),
    baseUrlVisibility: text("base_url_visibility", {
      enum: radarBaseUrlVisibility,
    })
      .default("hidden")
      .notNull(),
    providerType: text("provider_type", { enum: radarProviderTypes })
      .default("openai_compatible")
      .notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    notes: text("notes", { length: 1000 }).default("").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    index("radar_provider_workspace_id_idx").on(t.workspaceId),
    index("radar_provider_pool_id_idx").on(t.poolId),
  ],
);

export const radarCredential = sqliteTable(
  "radar_credential",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => radarProvider.id, { onDelete: "cascade" }),
    name: text("name", { length: 120 }).notNull(),
    description: text("description", { length: 500 }).default("").notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    keyFingerprint: text("key_fingerprint", { length: 128 }).notNull(),
    lastFour: text("last_four", { length: 8 }).notNull(),
    billingGroup: text("billing_group", { length: 120 }).default("").notNull(),
    modelGroup: text("model_group", { length: 120 }).default("").notNull(),
    modelCatalog: text("model_catalog", { mode: "json" })
      .$type<string[]>()
      .default([])
      .notNull(),
    dailyProbeLimit: integer("daily_probe_limit").default(288).notNull(),
    dailyTokenLimit: integer("daily_token_limit").default(2000).notNull(),
    dailyCostLimitCents: integer("daily_cost_limit_cents")
      .default(100)
      .notNull(),
    handoverExpiresAt: integer("handover_expires_at", { mode: "timestamp" }),
    pauseReason: text("pause_reason", {
      enum: radarCredentialPauseReasons,
    }),
    autoPausedAt: integer("auto_paused_at", { mode: "timestamp" }),
    nextRecoveryCheckAt: integer("next_recovery_check_at", {
      mode: "timestamp",
    }),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    index("radar_credential_workspace_id_idx").on(t.workspaceId),
    index("radar_credential_provider_id_idx").on(t.providerId),
  ],
);

export const radarProbeTarget = sqliteTable(
  "radar_probe_target",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    poolId: integer("pool_id")
      .notNull()
      .references(() => radarPool.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => radarProvider.id, { onDelete: "cascade" }),
    credentialId: integer("credential_id").references(
      () => radarCredential.id,
      {
        onDelete: "set null",
      },
    ),
    name: text("name", { length: 160 }).notNull(),
    displayName: text("display_name", { length: 160 }).notNull(),
    modelName: text("model_name", { length: 160 }).notNull(),
    endpointType: text("endpoint_type", { enum: radarEndpointTypes })
      .default("chat_completions")
      .notNull(),
    intervalSeconds: integer("interval_seconds").default(600).notNull(),
    timeoutMs: integer("timeout_ms").default(20000).notNull(),
    maxTokens: integer("max_tokens").default(8).notNull(),
    streamEnabled: integer("stream_enabled", { mode: "boolean" })
      .default(true)
      .notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    modelNotFoundCount: integer("model_not_found_count").default(0).notNull(),
    modelRetiredAt: integer("model_retired_at", {
      mode: "timestamp",
    }),
    nextCheckAt: integer("next_check_at", { mode: "timestamp" }),
    lastCheckStartedAt: integer("last_check_started_at", {
      mode: "timestamp",
    }),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    statusPolicy: text("status_policy", { mode: "json" }),
    currentStatus: text("current_status", { enum: radarTargetStatuses })
      .default("unknown")
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    index("radar_probe_target_workspace_id_idx").on(t.workspaceId),
    index("radar_probe_target_pool_id_idx").on(t.poolId),
    index("radar_probe_target_provider_id_idx").on(t.providerId),
    index("radar_probe_target_schedule_idx").on(t.enabled, t.nextCheckAt),
  ],
);

export const radarProbeRun = sqliteTable(
  "radar_probe_run",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    poolId: integer("pool_id")
      .notNull()
      .references(() => radarPool.id, { onDelete: "cascade" }),
    targetId: integer("target_id")
      .notNull()
      .references(() => radarProbeTarget.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => radarProvider.id, { onDelete: "cascade" }),
    credentialIdHash: text("credential_id_hash", { length: 128 }),
    region: text("region", { length: 80 }).default("default").notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    success: integer("success", { mode: "boolean" }).notNull(),
    httpStatus: integer("http_status"),
    errorType: text("error_type", { enum: radarErrorTypes }),
    safeErrorSummary: text("safe_error_summary", { length: 500 }),
    ttfbMs: integer("ttfb_ms"),
    firstTokenMs: integer("first_token_ms"),
    totalLatencyMs: integer("total_latency_ms"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    tokensPerSecond: integer("tokens_per_second"),
    estimatedCostMicros: integer("estimated_cost_micros"),
    promptTemplateVersion: text("prompt_template_version", { length: 40 })
      .default("health-v1")
      .notNull(),
    responseSampleHash: text("response_sample_hash", { length: 128 }),
    traceId: text("trace_id", { length: 128 }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    index("radar_probe_run_target_started_idx").on(t.targetId, t.startedAt),
    index("radar_probe_run_workspace_started_idx").on(
      t.workspaceId,
      t.startedAt,
    ),
  ],
);

export const radarTargetStatus = sqliteTable(
  "radar_target_status",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    targetId: integer("target_id")
      .notNull()
      .references(() => radarProbeTarget.id, { onDelete: "cascade" }),
    sampleCount1h: integer("sample_count_1h").default(0).notNull(),
    successRate1h: integer("success_rate_1h").default(0).notNull(),
    sampleCount24h: integer("sample_count_24h").default(0).notNull(),
    successRate24h: integer("success_rate_24h").default(0).notNull(),
    p50FirstTokenMs: integer("p50_first_token_ms"),
    p95FirstTokenMs: integer("p95_first_token_ms"),
    p50TotalLatencyMs: integer("p50_total_latency_ms"),
    p95TotalLatencyMs: integer("p95_total_latency_ms"),
    errorCountByType: text("error_count_by_type", { mode: "json" })
      .$type<Record<string, number>>()
      .default({}),
    lastCheckAt: integer("last_check_at", { mode: "timestamp" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
    lastFailureAt: integer("last_failure_at", { mode: "timestamp" }),
    currentStatus: text("current_status", { enum: radarTargetStatuses })
      .default("unknown")
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    uniqueIndex("radar_target_status_target_id_idx").on(t.targetId),
    index("radar_target_status_workspace_id_idx").on(t.workspaceId),
  ],
);

export const radarTargetOpenStatusBinding = sqliteTable(
  "radar_target_openstatus_binding",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    poolId: integer("pool_id")
      .notNull()
      .references(() => radarPool.id, { onDelete: "cascade" }),
    targetId: integer("target_id")
      .notNull()
      .references(() => radarProbeTarget.id, { onDelete: "cascade" }),
    pageId: integer("page_id").references(() => page.id, {
      onDelete: "set null",
    }),
    pageComponentId: integer("page_component_id").references(
      () => pageComponent.id,
      {
        onDelete: "set null",
      },
    ),
    monitorId: integer("monitor_id").references(() => monitor.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    uniqueIndex("radar_binding_target_id_idx").on(t.targetId),
    index("radar_binding_workspace_id_idx").on(t.workspaceId),
    index("radar_binding_page_id_idx").on(t.pageId),
    index("radar_binding_page_component_id_idx").on(t.pageComponentId),
  ],
);

export const radarNotificationEvent = sqliteTable(
  "radar_notification_event",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    poolId: integer("pool_id")
      .notNull()
      .references(() => radarPool.id, { onDelete: "cascade" }),
    targetId: integer("target_id")
      .notNull()
      .references(() => radarProbeTarget.id, { onDelete: "cascade" }),
    pageId: integer("page_id").references(() => page.id, {
      onDelete: "set null",
    }),
    runId: integer("run_id").references(() => radarProbeRun.id, {
      onDelete: "cascade",
    }),
    eventType: text("event_type", {
      enum: radarNotificationEventTypes,
    }).notNull(),
    severity: text("severity", {
      enum: radarNotificationSeverities,
    }).notNull(),
    previousStatus: text("previous_status", { enum: radarTargetStatuses }),
    currentStatus: text("current_status", {
      enum: radarTargetStatuses,
    }).notNull(),
    title: text("title", { length: 180 }).notNull(),
    message: text("message", { length: 1000 }).default("").notNull(),
    dedupeKey: text("dedupe_key", { length: 200 }).notNull(),
    status: text("status", {
      enum: radarNotificationDeliveryStatuses,
    })
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error", { length: 500 }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    dispatchedAt: integer("dispatched_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    uniqueIndex("radar_notification_event_dedupe_idx").on(t.dedupeKey),
    index("radar_notification_event_status_created_idx").on(
      t.status,
      t.createdAt,
    ),
    index("radar_notification_event_target_idx").on(t.targetId),
    index("radar_notification_event_page_idx").on(t.pageId),
  ],
);

export const radarPoolRelations = relations(radarPool, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [radarPool.workspaceId],
    references: [workspace.id],
  }),
  page: one(page, {
    fields: [radarPool.pageId],
    references: [page.id],
  }),
  providers: many(radarProvider),
  targets: many(radarProbeTarget),
}));

export const radarClaimApplicationRelations = relations(
  radarClaimApplication,
  ({ one, many }) => ({
    pool: one(radarPool, {
      fields: [radarClaimApplication.poolId],
      references: [radarPool.id],
    }),
    applicant: one(user, {
      fields: [radarClaimApplication.applicantUserId],
      references: [user.id],
    }),
    evidence: many(radarClaimApplicationEvidence),
  }),
);

export const radarClaimApplicationEvidenceRelations = relations(
  radarClaimApplicationEvidence,
  ({ one }) => ({
    application: one(radarClaimApplication, {
      fields: [radarClaimApplicationEvidence.applicationId],
      references: [radarClaimApplication.id],
    }),
    asset: one(mediaAsset, {
      fields: [radarClaimApplicationEvidence.assetId],
      references: [mediaAsset.id],
    }),
  }),
);

export const radarOrderRelations = relations(radarOrder, ({ one }) => ({
  user: one(user, {
    fields: [radarOrder.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [radarOrder.workspaceId],
    references: [workspace.id],
  }),
  verificationApplication: one(radarVerificationApplication, {
    fields: [radarOrder.verificationApplicationId],
    references: [radarVerificationApplication.id],
  }),
  pool: one(radarPool, {
    fields: [radarOrder.poolId],
    references: [radarPool.id],
  }),
  receiptAsset: one(mediaAsset, {
    fields: [radarOrder.receiptAssetId],
    references: [mediaAsset.id],
  }),
}));

export const radarProviderRelations = relations(
  radarProvider,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [radarProvider.workspaceId],
      references: [workspace.id],
    }),
    pool: one(radarPool, {
      fields: [radarProvider.poolId],
      references: [radarPool.id],
    }),
    credentials: many(radarCredential),
    targets: many(radarProbeTarget),
  }),
);

export const radarCredentialRelations = relations(
  radarCredential,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [radarCredential.workspaceId],
      references: [workspace.id],
    }),
    provider: one(radarProvider, {
      fields: [radarCredential.providerId],
      references: [radarProvider.id],
    }),
  }),
);

export const radarProbeTargetRelations = relations(
  radarProbeTarget,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [radarProbeTarget.workspaceId],
      references: [workspace.id],
    }),
    pool: one(radarPool, {
      fields: [radarProbeTarget.poolId],
      references: [radarPool.id],
    }),
    provider: one(radarProvider, {
      fields: [radarProbeTarget.providerId],
      references: [radarProvider.id],
    }),
    credential: one(radarCredential, {
      fields: [radarProbeTarget.credentialId],
      references: [radarCredential.id],
    }),
    runs: many(radarProbeRun),
    status: one(radarTargetStatus, {
      fields: [radarProbeTarget.id],
      references: [radarTargetStatus.targetId],
    }),
    binding: one(radarTargetOpenStatusBinding, {
      fields: [radarProbeTarget.id],
      references: [radarTargetOpenStatusBinding.targetId],
    }),
    notificationEvents: many(radarNotificationEvent),
  }),
);

export const radarProbeRunRelations = relations(radarProbeRun, ({ one }) => ({
  workspace: one(workspace, {
    fields: [radarProbeRun.workspaceId],
    references: [workspace.id],
  }),
  pool: one(radarPool, {
    fields: [radarProbeRun.poolId],
    references: [radarPool.id],
  }),
  target: one(radarProbeTarget, {
    fields: [radarProbeRun.targetId],
    references: [radarProbeTarget.id],
  }),
  provider: one(radarProvider, {
    fields: [radarProbeRun.providerId],
    references: [radarProvider.id],
  }),
}));

export const radarTargetStatusRelations = relations(
  radarTargetStatus,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [radarTargetStatus.workspaceId],
      references: [workspace.id],
    }),
    target: one(radarProbeTarget, {
      fields: [radarTargetStatus.targetId],
      references: [radarProbeTarget.id],
    }),
  }),
);

export const radarTargetOpenStatusBindingRelations = relations(
  radarTargetOpenStatusBinding,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [radarTargetOpenStatusBinding.workspaceId],
      references: [workspace.id],
    }),
    pool: one(radarPool, {
      fields: [radarTargetOpenStatusBinding.poolId],
      references: [radarPool.id],
    }),
    target: one(radarProbeTarget, {
      fields: [radarTargetOpenStatusBinding.targetId],
      references: [radarProbeTarget.id],
    }),
    page: one(page, {
      fields: [radarTargetOpenStatusBinding.pageId],
      references: [page.id],
    }),
    pageComponent: one(pageComponent, {
      fields: [radarTargetOpenStatusBinding.pageComponentId],
      references: [pageComponent.id],
    }),
    monitor: one(monitor, {
      fields: [radarTargetOpenStatusBinding.monitorId],
      references: [monitor.id],
    }),
  }),
);

export const radarNotificationEventRelations = relations(
  radarNotificationEvent,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [radarNotificationEvent.workspaceId],
      references: [workspace.id],
    }),
    pool: one(radarPool, {
      fields: [radarNotificationEvent.poolId],
      references: [radarPool.id],
    }),
    target: one(radarProbeTarget, {
      fields: [radarNotificationEvent.targetId],
      references: [radarProbeTarget.id],
    }),
    page: one(page, {
      fields: [radarNotificationEvent.pageId],
      references: [page.id],
    }),
    run: one(radarProbeRun, {
      fields: [radarNotificationEvent.runId],
      references: [radarProbeRun.id],
    }),
  }),
);
