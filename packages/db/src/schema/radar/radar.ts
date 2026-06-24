import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { monitor } from "../monitors";
import { page } from "../pages";
import { workspace } from "../workspaces";
import {
  radarBaseUrlVisibility,
  radarEndpointTypes,
  radarErrorTypes,
  radarPoolVisibility,
  radarProviderTypes,
  radarTargetStatuses,
} from "./constants";

export const radarPool = sqliteTable(
  "radar_pool",
  {
    id: integer("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name", { length: 120 }).notNull(),
    slug: text("slug", { length: 80 }).notNull(),
    description: text("description", { length: 500 }).default("").notNull(),
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
  },
  (t) => [
    uniqueIndex("radar_pool_workspace_slug_idx").on(t.workspaceId, t.slug),
    index("radar_pool_workspace_id_idx").on(t.workspaceId),
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
    credentialId: integer("credential_id").references(() => radarCredential.id, {
      onDelete: "set null",
    }),
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
    monitor: one(monitor, {
      fields: [radarTargetOpenStatusBinding.monitorId],
      references: [monitor.id],
    }),
  }),
);
