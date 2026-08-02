import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const providerStatus = pgEnum("provider_status", [
  "draft",
  "observing",
  "published",
  "suspended",
]);

export const listingStatus = pgEnum("listing_status", [
  "draft",
  "observing",
  "ranked",
  "suspended",
  "retired",
]);

export const modelVisibility = pgEnum("model_visibility", [
  "auto",
  "show",
  "hide",
]);

export const probeOutcome = pgEnum("probe_outcome", [
  "success",
  "provider_failure",
  "configuration_error",
  "observer_error",
]);

export const probeTargetSource = pgEnum("probe_target_source", [
  "native",
  "legacy_radar",
]);

export const currentStatus = pgEnum("current_status", [
  "unknown",
  "normal",
  "degraded",
  "down",
  "configuration_error",
  "stale",
]);

export const availabilityGrade = pgEnum("availability_grade", [
  "S",
  "A",
  "B",
  "C",
  "D",
]);

export const sponsorshipStatus = pgEnum("sponsorship_status", [
  "draft",
  "scheduled",
  "active",
  "paused",
  "ended",
]);

export const hubProviderManagementMode = pgEnum(
  "hub_provider_management_mode",
  ["platform_managed", "provider_managed"],
);

export const hubProviderStatus = pgEnum("hub_provider_status", [
  "draft",
  "active",
  "suspended",
  "retired",
]);

export const hubGroupLifecycleStatus = pgEnum("hub_group_lifecycle_status", [
  "draft",
  "verifying",
  "ready",
  "retired",
]);

export const hubGroupDesiredStatus = pgEnum("hub_group_desired_status", [
  "active",
  "paused",
  "retired",
]);

export const hubGroupListingStatus = pgEnum("hub_group_listing_status", [
  "private",
  "pending",
  "listed",
  "delisted",
]);

export const hubGroupBlockSource = pgEnum("hub_group_block_source", [
  "manual",
  "balance",
  "auth",
  "health",
  "admin",
  "system",
]);

export const hubBalanceStatus = pgEnum("hub_balance_status", [
  "unknown",
  "available",
  "low",
  "exhausted",
  "error",
]);

export const hubModelStatus = pgEnum("hub_model_status", [
  "active",
  "deprecated",
  "retired",
]);

export const hubGroupModelDiscoveryStatus = pgEnum(
  "hub_group_model_discovery_status",
  ["unmapped", "active", "missing", "retired"],
);

export const hubProbeEndpointType = pgEnum("hub_probe_endpoint_type", [
  "chat_completions",
]);

export const hubProbeCycleStatus = pgEnum("hub_probe_cycle_status", [
  "running",
  "completed",
  "failed",
]);

export const hubApiTokenStatus = pgEnum("hub_api_token_status", [
  "active",
  "revoked",
]);

export const hubRequestStatus = pgEnum("hub_request_status", [
  "planned",
  "running",
  "succeeded",
  "failed",
]);

export const hubRouteAttemptOutcome = pgEnum("hub_route_attempt_outcome", [
  "success",
  "provider_failure",
  "configuration_error",
  "aborted",
]);

export const hubUsageStatus = pgEnum("hub_usage_status", ["posted", "void"]);
export const hubBillingAuthorizationStatus = pgEnum(
  "hub_billing_authorization_status",
  ["reserved", "captured", "released", "expired"],
);

export const hubLedgerAccountType = pgEnum("hub_ledger_account_type", [
  "user_credit",
  "provider_payable",
  "platform_revenue",
  "adjustment",
]);

export const hubLedgerJournalStatus = pgEnum("hub_ledger_journal_status", [
  "posted",
  "reversed",
]);

export const hubLedgerDirection = pgEnum("hub_ledger_direction", [
  "debit",
  "credit",
]);

export const hubBillingMode = pgEnum("hub_billing_mode", [
  "token",
  "per_request",
  "component",
  "tiered",
]);

export const hubPriceComponentKind = pgEnum("hub_price_component_kind", [
  "input_text",
  "output_text",
  "cache_read",
  "cache_write",
  "input_audio",
  "output_audio",
  "image",
  "request",
  "other",
]);

export const hubPriceUnit = pgEnum("hub_price_unit", [
  "million_tokens",
  "thousand_tokens",
  "image",
  "second",
  "request",
  "unit",
]);

export const marketplaceSettings = pgTable(
  "marketplace_settings",
  {
    id: text("id").primaryKey(),
    minRankingAvailabilityBps: integer("min_ranking_availability_bps")
      .default(8_000)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "marketplace_settings_min_ranking_check",
      sql`${table.minRankingAvailabilityBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const hubProviders = pgTable(
  "hub_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerWorkspaceId: text("owner_workspace_id"),
    managementMode: hubProviderManagementMode("management_mode")
      .default("provider_managed")
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").default("").notNull(),
    websiteUrl: text("website_url"),
    logoAssetId: text("logo_asset_id"),
    claimable: boolean("claimable").default(false).notNull(),
    status: hubProviderStatus("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_providers_slug_uidx").on(table.slug),
    index("hub_providers_owner_idx").on(table.ownerWorkspaceId),
    index("hub_providers_status_idx").on(table.status),
    check(
      "hub_providers_owner_check",
      sql`(
        ${table.managementMode} = 'platform_managed' OR
        ${table.ownerWorkspaceId} IS NOT NULL
      )`,
    ),
  ],
);

export const hubProviderGroups = pgTable(
  "hub_provider_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => hubProviders.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    baseUrlCiphertext: text("base_url_ciphertext").notNull(),
    baseUrlHostHash: text("base_url_host_hash").notNull(),
    lifecycleStatus: hubGroupLifecycleStatus("lifecycle_status")
      .default("draft")
      .notNull(),
    desiredStatus: hubGroupDesiredStatus("desired_status")
      .default("active")
      .notNull(),
    listingStatus: hubGroupListingStatus("listing_status")
      .default("private")
      .notNull(),
    listingSubmittedAt: timestamp("listing_submitted_at", {
      withTimezone: true,
    }),
    listingReviewedAt: timestamp("listing_reviewed_at", {
      withTimezone: true,
    }),
    listingReviewedBy: text("listing_reviewed_by"),
    listingReviewNote: text("listing_review_note"),
    configVersion: integer("config_version").default(1).notNull(),
    lastBalanceMicros: bigint("last_balance_micros", { mode: "bigint" }),
    balanceCurrency: text("balance_currency"),
    balanceStatus: hubBalanceStatus("balance_status")
      .default("unknown")
      .notNull(),
    balanceCheckedAt: timestamp("balance_checked_at", { withTimezone: true }),
    balanceStaleAt: timestamp("balance_stale_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_provider_groups_provider_name_uidx").on(
      table.providerId,
      table.name,
    ),
    index("hub_provider_groups_provider_idx").on(table.providerId),
    index("hub_provider_groups_runtime_idx").on(
      table.lifecycleStatus,
      table.desiredStatus,
      table.listingStatus,
    ),
    check(
      "hub_provider_groups_config_version_check",
      sql`${table.configVersion} > 0`,
    ),
    check(
      "hub_provider_groups_balance_check",
      sql`(
        (${table.lastBalanceMicros} IS NULL AND ${table.balanceCurrency} IS NULL) OR
        (${table.lastBalanceMicros} >= 0 AND ${table.balanceCurrency} IS NOT NULL)
      )`,
    ),
  ],
);

export const hubGroupBlocks = pgTable(
  "hub_group_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    source: hubGroupBlockSource("source").notNull(),
    reasonCode: text("reason_code").notNull(),
    stopsTraffic: boolean("stops_traffic").default(true).notNull(),
    stopsProbes: boolean("stops_probes").default(false).notNull(),
    autoClear: boolean("auto_clear").default(false).notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("hub_group_blocks_active_uidx")
      .on(table.groupId, table.source, table.reasonCode)
      .where(sql`${table.resolvedAt} IS NULL`),
    index("hub_group_blocks_group_active_idx").on(
      table.groupId,
      table.resolvedAt,
    ),
  ],
);

export const hubGroupSecrets = pgTable(
  "hub_group_secrets",
  {
    groupId: uuid("group_id")
      .primaryKey()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    lastFour: text("last_four").notNull(),
    secretVersion: integer("secret_version").default(1).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("hub_group_secrets_fingerprint_idx").on(table.keyFingerprint),
    check("hub_group_secrets_version_check", sql`${table.secretVersion} > 0`),
  ],
);

export const hubModels = pgTable(
  "hub_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    vendor: text("vendor").notNull(),
    family: text("family").notNull(),
    canonicalName: text("canonical_name").notNull(),
    displayName: text("display_name").notNull(),
    shortName: text("short_name").notNull(),
    description: text("description").default("").notNull(),
    capabilities: text("capabilities")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    status: hubModelStatus("status").default("active").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_models_slug_uidx").on(table.slug),
    uniqueIndex("hub_models_canonical_name_uidx").on(table.canonicalName),
    index("hub_models_catalog_idx").on(
      table.status,
      table.vendor,
      table.sortOrder,
    ),
  ],
);

export const hubModelAliases = pgTable(
  "hub_model_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => hubModels.id, { onDelete: "restrict" }),
    namespace: text("namespace").default("global").notNull(),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_model_aliases_namespace_alias_uidx").on(
      table.namespace,
      table.normalizedAlias,
    ),
    index("hub_model_aliases_model_idx").on(table.modelId),
  ],
);

export const hubModelPriceVersions = pgTable(
  "hub_model_price_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => hubModels.id, { onDelete: "restrict" }),
    currency: text("currency").default("USD").notNull(),
    billingMode: hubBillingMode("billing_mode").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    source: text("source").notNull(),
    sourceVersion: text("source_version"),
    changedByUserId: text("changed_by_user_id"),
    changeReason: text("change_reason").default("").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_model_price_versions_start_uidx").on(
      table.modelId,
      table.currency,
      table.effectiveFrom,
    ),
    index("hub_model_price_versions_current_idx").on(
      table.modelId,
      table.currency,
      table.effectiveTo,
    ),
    check(
      "hub_model_price_versions_window_check",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const hubModelPriceComponents = pgTable(
  "hub_model_price_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    priceVersionId: uuid("price_version_id")
      .notNull()
      .references(() => hubModelPriceVersions.id, { onDelete: "restrict" }),
    component: hubPriceComponentKind("component").notNull(),
    unit: hubPriceUnit("unit").notNull(),
    unitSize: integer("unit_size").default(1).notNull(),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    tierKey: text("tier_key").default("default").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_model_price_components_identity_uidx").on(
      table.priceVersionId,
      table.component,
      table.unit,
      table.tierKey,
    ),
    index("hub_model_price_components_version_idx").on(table.priceVersionId),
    check(
      "hub_model_price_components_unit_size_check",
      sql`${table.unitSize} > 0`,
    ),
    check(
      "hub_model_price_components_amount_check",
      sql`${table.amountMicros} >= 0`,
    ),
  ],
);

export const hubGroupPriceVersions = pgTable(
  "hub_group_price_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    multiplierBps: integer("multiplier_bps").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    changedByUserId: text("changed_by_user_id"),
    changeReason: text("change_reason").default("").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_group_price_versions_start_uidx").on(
      table.groupId,
      table.effectiveFrom,
    ),
    index("hub_group_price_versions_current_idx").on(
      table.groupId,
      table.effectiveTo,
    ),
    check(
      "hub_group_price_versions_multiplier_check",
      sql`${table.multiplierBps} >= 0`,
    ),
    check(
      "hub_group_price_versions_window_check",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const hubGroupModels = pgTable(
  "hub_group_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    modelId: uuid("model_id").references(() => hubModels.id, {
      onDelete: "restrict",
    }),
    relayChannelBindingId: uuid("relay_channel_binding_id").references(
      () => hubRelayChannelBindings.id,
      { onDelete: "restrict" },
    ),
    upstreamModelName: text("upstream_model_name").notNull(),
    normalizedUpstreamName: text("normalized_upstream_name").notNull(),
    baseUrlOverrideCiphertext: text("base_url_override_ciphertext"),
    baseUrlOverrideHostHash: text("base_url_override_host_hash"),
    discoveryStatus: hubGroupModelDiscoveryStatus("discovery_status")
      .default("unmapped")
      .notNull(),
    trafficEnabled: boolean("traffic_enabled").default(false).notNull(),
    probeEnabled: boolean("probe_enabled").default(false).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    missingCount: integer("missing_count").default(0).notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_group_models_upstream_name_uidx").on(
      table.groupId,
      table.normalizedUpstreamName,
    ),
    index("hub_group_models_group_status_idx").on(
      table.groupId,
      table.discoveryStatus,
    ),
    index("hub_group_models_model_status_idx").on(
      table.modelId,
      table.discoveryStatus,
    ),
    index("hub_group_models_relay_binding_idx").on(table.relayChannelBindingId),
    check(
      "hub_group_models_mapping_check",
      sql`(
        (${table.modelId} IS NOT NULL AND ${table.discoveryStatus} <> 'unmapped') OR
        (NOT ${table.trafficEnabled} AND NOT ${table.probeEnabled})
      )`,
    ),
    check(
      "hub_group_models_missing_count_check",
      sql`${table.missingCount} >= 0`,
    ),
    check(
      "hub_group_models_base_url_override_check",
      sql`(
        (${table.baseUrlOverrideCiphertext} IS NULL AND ${table.baseUrlOverrideHostHash} IS NULL) OR
        (${table.baseUrlOverrideCiphertext} IS NOT NULL AND ${table.baseUrlOverrideHostHash} IS NOT NULL)
      )`,
    ),
  ],
);

export const hubConfigOutbox = pgTable(
  "hub_config_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    configVersion: integer("config_version").notNull(),
    action: text("action").notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_config_outbox_group_version_uidx").on(
      table.groupId,
      table.configVersion,
      table.action,
    ),
    index("hub_config_outbox_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.lockedUntil,
    ),
    check(
      "hub_config_outbox_action_check",
      sql`${table.action} IN ('upsert', 'disable')`,
    ),
    check(
      "hub_config_outbox_status_check",
      sql`${table.status} IN ('pending', 'processing', 'applied', 'failed')`,
    ),
    check(
      "hub_config_outbox_counts_check",
      sql`${table.configVersion} > 0 AND ${table.attempts} >= 0`,
    ),
  ],
);

export const hubRelayChannelBindings = pgTable(
  "hub_relay_channel_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    routeKey: text("route_key").notNull(),
    externalChannelId: text("external_channel_id").notNull(),
    appliedConfigVersion: integer("applied_config_version").notNull(),
    configChecksum: text("config_checksum").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_relay_channel_bindings_route_uidx").on(
      table.groupId,
      table.routeKey,
    ),
    uniqueIndex("hub_relay_channel_bindings_external_uidx").on(
      table.externalChannelId,
    ),
    index("hub_relay_channel_bindings_group_idx").on(table.groupId),
    check(
      "hub_relay_channel_bindings_version_check",
      sql`${table.appliedConfigVersion} > 0`,
    ),
  ],
);

export const hubProbeTargets = pgTable(
  "hub_probe_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupModelId: uuid("group_model_id")
      .notNull()
      .references(() => hubGroupModels.id, { onDelete: "restrict" }),
    endpointType: hubProbeEndpointType("endpoint_type")
      .default("chat_completions")
      .notNull(),
    intervalSeconds: integer("interval_seconds").default(600).notNull(),
    timeoutMs: integer("timeout_ms").default(20_000).notNull(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseToken: uuid("lease_token"),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    enabled: boolean("enabled").default(true).notNull(),
    modelNotFoundCount: integer("model_not_found_count").default(0).notNull(),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_probe_targets_group_model_uidx").on(table.groupModelId),
    index("hub_probe_targets_due_idx").on(
      table.enabled,
      table.nextCheckAt,
      table.lockedUntil,
    ),
    check(
      "hub_probe_targets_interval_check",
      sql`${table.intervalSeconds} BETWEEN 60 AND 86400`,
    ),
    check(
      "hub_probe_targets_timeout_check",
      sql`${table.timeoutMs} BETWEEN 1000 AND 120000`,
    ),
    check(
      "hub_probe_targets_model_not_found_check",
      sql`${table.modelNotFoundCount} >= 0`,
    ),
    check(
      "hub_probe_targets_lease_check",
      sql`(
        (${table.leaseToken} IS NULL AND ${table.lockedBy} IS NULL AND ${table.lockedUntil} IS NULL) OR
        (${table.leaseToken} IS NOT NULL AND ${table.lockedBy} IS NOT NULL AND ${table.lockedUntil} IS NOT NULL)
      )`,
    ),
  ],
);

export const hubProbeCycles = pgTable(
  "hub_probe_cycles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => hubProbeTargets.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: hubProbeCycleStatus("status").default("running").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_probe_cycles_target_schedule_uidx").on(
      table.targetId,
      table.scheduledAt,
    ),
    index("hub_probe_cycles_status_idx").on(table.status, table.scheduledAt),
  ],
);

export const hubProbeRuns = pgTable(
  "hub_probe_runs",
  {
    targetId: uuid("target_id")
      .notNull()
      .references(() => hubProbeTargets.id, { onDelete: "restrict" }),
    groupModelId: uuid("group_model_id")
      .notNull()
      .references(() => hubGroupModels.id, { onDelete: "restrict" }),
    probeCycleId: uuid("probe_cycle_id")
      .notNull()
      .references(() => hubProbeCycles.id, { onDelete: "restrict" }),
    attemptNo: smallint("attempt_no").default(0).notNull(),
    outcome: probeOutcome("outcome").notNull(),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    safeErrorSummary: text("safe_error_summary"),
    ttfbMs: integer("ttfb_ms"),
    firstTokenMs: integer("first_token_ms"),
    totalLatencyMs: integer("total_latency_ms").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    upstreamRequestId: text("upstream_request_id"),
    configVersion: integer("config_version").notNull(),
    secretVersion: integer("secret_version").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "hub_probe_runs_pk",
      columns: [
        table.targetId,
        table.probeCycleId,
        table.attemptNo,
        table.scheduledAt,
      ],
    }),
    index("hub_probe_runs_group_model_schedule_idx").on(
      table.groupModelId,
      table.scheduledAt,
    ),
    check("hub_probe_runs_attempt_check", sql`${table.attemptNo} >= 0`),
    check("hub_probe_runs_config_check", sql`${table.configVersion} > 0`),
    check("hub_probe_runs_latency_check", sql`${table.totalLatencyMs} >= 0`),
    check(
      "hub_probe_runs_time_check",
      sql`${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const hubHealthBuckets3h = pgTable(
  "hub_health_buckets_3h",
  {
    groupModelId: uuid("group_model_id")
      .notNull()
      .references(() => hubGroupModels.id, { onDelete: "restrict" }),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    expectedCount: integer("expected_count").default(0).notNull(),
    attemptedCount: integer("attempted_count").default(0).notNull(),
    successCount: integer("success_count").default(0).notNull(),
    providerFailureCount: integer("provider_failure_count")
      .default(0)
      .notNull(),
    configurationErrorCount: integer("configuration_error_count")
      .default(0)
      .notNull(),
    observerErrorCount: integer("observer_error_count").default(0).notNull(),
    slowSuccessCount: integer("slow_success_count").default(0).notNull(),
    availabilityBps: integer("availability_bps"),
    coverageBps: integer("coverage_bps").default(0).notNull(),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "hub_health_buckets_3h_pk",
      columns: [table.groupModelId, table.bucketStart],
    }),
    check(
      "hub_health_buckets_3h_counts_check",
      sql`${table.expectedCount} >= 0 AND ${table.attemptedCount} >= 0 AND ${table.successCount} >= 0 AND ${table.providerFailureCount} >= 0 AND ${table.configurationErrorCount} >= 0 AND ${table.observerErrorCount} >= 0 AND ${table.slowSuccessCount} >= 0`,
    ),
    check(
      "hub_health_buckets_3h_ratios_check",
      sql`(${table.availabilityBps} IS NULL OR ${table.availabilityBps} BETWEEN 0 AND 10000) AND ${table.coverageBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const hubGroupModelStats = pgTable(
  "hub_group_model_stats",
  {
    groupModelId: uuid("group_model_id")
      .primaryKey()
      .references(() => hubGroupModels.id, { onDelete: "restrict" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    availabilityBps: integer("availability_bps"),
    coverageBps: integer("coverage_bps").default(0).notNull(),
    grade: availabilityGrade("grade"),
    firstTokenP50Ms: integer("first_token_p50_ms"),
    firstTokenP95Ms: integer("first_token_p95_ms"),
    sampleCount: integer("sample_count").default(0).notNull(),
    validBucketCount: integer("valid_bucket_count").default(0).notNull(),
    rankingScoreBps: integer("ranking_score_bps"),
    scoringVersion: integer("scoring_version").default(1).notNull(),
    currentStatus: currentStatus("current_status").default("unknown").notNull(),
    eligible: boolean("eligible").default(false).notNull(),
    eligibilityReason: text("eligibility_reason"),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("hub_group_model_stats_ranking_idx").on(
      table.eligible,
      table.rankingScoreBps,
    ),
    check(
      "hub_group_model_stats_window_check",
      sql`${table.windowEnd} > ${table.windowStart}`,
    ),
    check(
      "hub_group_model_stats_ratios_check",
      sql`(${table.availabilityBps} IS NULL OR ${table.availabilityBps} BETWEEN 0 AND 10000) AND ${table.coverageBps} BETWEEN 0 AND 10000 AND (${table.rankingScoreBps} IS NULL OR ${table.rankingScoreBps} BETWEEN 0 AND 10000)`,
    ),
    check(
      "hub_group_model_stats_counts_check",
      sql`${table.sampleCount} >= 0 AND ${table.validBucketCount} >= 0 AND ${table.scoringVersion} > 0`,
    ),
  ],
);

export const hubApiTokens = pgTable(
  "hub_api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: hubApiTokenStatus("status").default("active").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    routingRevision: integer("routing_revision").default(1).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_api_tokens_hash_uidx").on(table.tokenHash),
    index("hub_api_tokens_owner_status_idx").on(
      table.ownerUserId,
      table.status,
    ),
    check("hub_api_tokens_revision_check", sql`${table.routingRevision} > 0`),
  ],
);

export const hubTokenGroupPreferences = pgTable(
  "hub_token_group_preferences",
  {
    tokenId: uuid("token_id")
      .notNull()
      .references(() => hubApiTokens.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => hubProviderGroups.id, { onDelete: "restrict" }),
    priority: integer("priority").default(0).notNull(),
    weight: integer("weight").default(100).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "hub_token_group_preferences_pk",
      columns: [table.tokenId, table.groupId],
    }),
    index("hub_token_group_preferences_group_idx").on(table.groupId),
    check(
      "hub_token_group_preferences_priority_check",
      sql`${table.priority} >= 0`,
    ),
    check(
      "hub_token_group_preferences_weight_check",
      sql`${table.weight} >= 0`,
    ),
  ],
);

export const hubRequests = pgTable(
  "hub_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => hubApiTokens.id, { onDelete: "restrict" }),
    canonicalModelId: uuid("canonical_model_id")
      .notNull()
      .references(() => hubModels.id, { onDelete: "restrict" }),
    routePlanVersion: integer("route_plan_version").notNull(),
    routePlan: jsonb("route_plan")
      .$type<
        Array<{
          groupModelId: string;
          relayChannelBindingId: string;
          externalChannelId: string;
          upstreamModel: string;
          configVersion: number;
        }>
      >()
      .notNull(),
    status: hubRequestStatus("status").default("planned").notNull(),
    finalGroupModelId: uuid("final_group_model_id").references(
      () => hubGroupModels.id,
      { onDelete: "restrict" },
    ),
    externalRequestId: text("external_request_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("hub_requests_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
    index("hub_requests_token_created_idx").on(table.tokenId, table.createdAt),
    check(
      "hub_requests_route_plan_version_check",
      sql`${table.routePlanVersion} > 0`,
    ),
  ],
);

export const hubRequestAttempts = pgTable(
  "hub_request_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => hubRequests.id, { onDelete: "restrict" }),
    attemptNo: smallint("attempt_no").notNull(),
    groupModelId: uuid("group_model_id")
      .notNull()
      .references(() => hubGroupModels.id, { onDelete: "restrict" }),
    relayChannelBindingId: uuid("relay_channel_binding_id").references(
      () => hubRelayChannelBindings.id,
      { onDelete: "restrict" },
    ),
    externalChannelId: text("external_channel_id"),
    configVersion: integer("config_version").notNull(),
    outcome: hubRouteAttemptOutcome("outcome").notNull(),
    errorCode: text("error_code"),
    upstreamRequestId: text("upstream_request_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_request_attempts_request_no_uidx").on(
      table.requestId,
      table.attemptNo,
    ),
    index("hub_request_attempts_group_created_idx").on(
      table.groupModelId,
      table.createdAt,
    ),
    check("hub_request_attempts_no_check", sql`${table.attemptNo} >= 0`),
    check(
      "hub_request_attempts_version_check",
      sql`${table.configVersion} > 0`,
    ),
  ],
);

export const hubLedgerAccounts = pgTable(
  "hub_ledger_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountKey: text("account_key").notNull(),
    accountType: hubLedgerAccountType("account_type").notNull(),
    ownerId: text("owner_id"),
    currency: text("currency").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_ledger_accounts_key_uidx").on(table.accountKey),
    index("hub_ledger_accounts_owner_idx").on(table.ownerId, table.accountType),
  ],
);

export const hubLedgerJournals = pgTable(
  "hub_ledger_journals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    currency: text("currency").notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    status: hubLedgerJournalStatus("status").default("posted").notNull(),
    reversalOfJournalId: uuid("reversal_of_journal_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_ledger_journals_idempotency_uidx").on(
      table.idempotencyKey,
    ),
    index("hub_ledger_journals_source_idx").on(
      table.sourceType,
      table.sourceId,
    ),
  ],
);

export const hubLedgerLines = pgTable(
  "hub_ledger_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => hubLedgerJournals.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => hubLedgerAccounts.id, { onDelete: "restrict" }),
    lineNo: smallint("line_no").notNull(),
    direction: hubLedgerDirection("direction").notNull(),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_ledger_lines_journal_no_uidx").on(
      table.journalId,
      table.lineNo,
    ),
    index("hub_ledger_lines_account_idx").on(table.accountId, table.createdAt),
    check("hub_ledger_lines_no_check", sql`${table.lineNo} > 0`),
    check("hub_ledger_lines_amount_check", sql`${table.amountMicros} > 0`),
  ],
);

export const hubBillingAuthorizations = pgTable(
  "hub_billing_authorizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => hubRequests.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id").notNull(),
    currency: text("currency").default("USD").notNull(),
    reservedAmountMicros: bigint("reserved_amount_micros", {
      mode: "bigint",
    }).notNull(),
    capturedAmountMicros: bigint("captured_amount_micros", {
      mode: "bigint",
    }),
    settlementPayload: jsonb("settlement_payload").$type<{
      ownerId: string;
      tokenId: string;
      requestId: string;
      sourceSystem: string;
      sourceEventId: string;
      modelId: string;
      groupId: string;
      finalGroupModelId: string;
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
      externalRequestId?: string | null;
    }>(),
    status: hubBillingAuthorizationStatus("status")
      .default("reserved")
      .notNull(),
    reservationJournalId: uuid("reservation_journal_id")
      .notNull()
      .references(() => hubLedgerJournals.id, { onDelete: "restrict" }),
    settlementJournalId: uuid("settlement_journal_id").references(
      () => hubLedgerJournals.id,
      { onDelete: "restrict" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_billing_authorizations_request_uidx").on(table.requestId),
    index("hub_billing_authorizations_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "hub_billing_authorizations_amount_check",
      sql`${table.reservedAmountMicros} > 0 AND (${table.capturedAmountMicros} IS NULL OR ${table.capturedAmountMicros} >= 0)`,
    ),
  ],
);

export const hubUsageRecords = pgTable(
  "hub_usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => hubRequests.id, { onDelete: "restrict" }),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => hubApiTokens.id, { onDelete: "restrict" }),
    finalGroupModelId: uuid("final_group_model_id")
      .notNull()
      .references(() => hubGroupModels.id, { onDelete: "restrict" }),
    modelPriceVersionId: uuid("model_price_version_id").references(
      () => hubModelPriceVersions.id,
      { onDelete: "restrict" },
    ),
    groupPriceVersionId: uuid("group_price_version_id").references(
      () => hubGroupPriceVersions.id,
      { onDelete: "restrict" },
    ),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    pricingSnapshot: jsonb("pricing_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    userAmountMicros: bigint("user_amount_micros", {
      mode: "bigint",
    }).notNull(),
    providerPayoutMicros: bigint("provider_payout_micros", {
      mode: "bigint",
    }).notNull(),
    platformFeeMicros: bigint("platform_fee_micros", {
      mode: "bigint",
    }).notNull(),
    currency: text("currency").notNull(),
    status: hubUsageStatus("status").default("posted").notNull(),
    ledgerJournalId: uuid("ledger_journal_id").references(
      () => hubLedgerJournals.id,
      { onDelete: "restrict" },
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("hub_usage_records_request_uidx").on(table.requestId),
    uniqueIndex("hub_usage_records_source_uidx").on(
      table.sourceSystem,
      table.sourceEventId,
    ),
    index("hub_usage_records_token_created_idx").on(
      table.tokenId,
      table.createdAt,
    ),
    check(
      "hub_usage_records_tokens_check",
      sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.cacheReadTokens} >= 0 AND ${table.cacheWriteTokens} >= 0`,
    ),
    check(
      "hub_usage_records_amounts_check",
      sql`${table.userAmountMicros} >= 0 AND ${table.providerPayoutMicros} >= 0 AND ${table.platformFeeMicros} >= 0`,
    ),
  ],
);

export const providers = pgTable(
  "providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    websiteUrl: text("website_url"),
    logoUrl: text("logo_url"),
    status: providerStatus("status").default("draft").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("providers_slug_uidx").on(table.slug),
    index("providers_status_idx").on(table.status),
  ],
);

export const models = pgTable(
  "models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    vendor: text("vendor").notNull(),
    family: text("family").notNull(),
    displayName: text("display_name").notNull(),
    shortName: text("short_name").notNull(),
    description: text("description").default("").notNull(),
    aliases: text("aliases")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    visibility: modelVisibility("visibility").default("auto").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("models_slug_uidx").on(table.slug),
    index("models_catalog_idx").on(
      table.enabled,
      table.vendor,
      table.sortOrder,
    ),
  ],
);

export const providerModels = pgTable(
  "provider_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "restrict" }),
    providerModelName: text("provider_model_name").notNull(),
    purchaseUrl: text("purchase_url"),
    status: listingStatus("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_models_provider_model_uidx").on(
      table.providerId,
      table.modelId,
    ),
    index("provider_models_model_status_idx").on(table.modelId, table.status),
    index("provider_models_provider_idx").on(table.providerId),
  ],
);

export const probeTargets = pgTable(
  "probe_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerModelId: uuid("provider_model_id")
      .notNull()
      .references(() => providerModels.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    source: probeTargetSource("source").default("native").notNull(),
    sourceRef: text("source_ref"),
    endpointUrlCiphertext: text("endpoint_url"),
    endpointType: text("endpoint_type").default("openai_compatible").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyFingerprint: text("api_key_fingerprint"),
    apiKeyLastFour: text("api_key_last_four"),
    intervalSeconds: integer("interval_seconds").default(600).notNull(),
    timeoutMs: integer("timeout_ms").default(20_000).notNull(),
    isScoring: boolean("is_scoring").default(true).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("probe_targets_active_scoring_uidx")
      .on(table.providerModelId)
      .where(sql`${table.isScoring} AND ${table.enabled}`),
    uniqueIndex("probe_targets_source_ref_uidx").on(
      table.source,
      table.sourceRef,
    ),
    index("probe_targets_schedule_idx").on(table.enabled, table.nextCheckAt),
    index("probe_targets_provider_model_idx").on(table.providerModelId),
    check("probe_targets_interval_check", sql`${table.intervalSeconds} >= 60`),
    check("probe_targets_timeout_check", sql`${table.timeoutMs} >= 1000`),
    check(
      "probe_targets_source_config_check",
      sql`(
        ${table.source} = 'legacy_radar' AND ${table.sourceRef} IS NOT NULL
      ) OR (
        ${table.source} = 'native' AND
        ${table.endpointUrlCiphertext} IS NOT NULL AND
        ${table.apiKeyCiphertext} IS NOT NULL AND
        ${table.apiKeyFingerprint} IS NOT NULL AND
        ${table.apiKeyLastFour} IS NOT NULL
      )`,
    ),
  ],
);

export const probeChecks = pgTable(
  "probe_checks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => probeTargets.id, { onDelete: "restrict" }),
    providerModelId: uuid("provider_model_id")
      .notNull()
      .references(() => providerModels.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    attemptNo: smallint("attempt_no").default(0).notNull(),
    outcome: probeOutcome("outcome").notNull(),
    errorCode: text("error_code"),
    safeErrorSummary: text("safe_error_summary"),
    httpStatus: integer("http_status"),
    firstTokenMs: integer("first_token_ms"),
    totalLatencyMs: integer("total_latency_ms"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    responseSampleHash: text("response_sample_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("probe_checks_episode_attempt_uidx").on(
      table.targetId,
      table.scheduledAt,
      table.attemptNo,
    ),
    index("probe_checks_provider_model_scheduled_idx").on(
      table.providerModelId,
      table.scheduledAt,
    ),
    index("probe_checks_target_scheduled_idx").on(
      table.targetId,
      table.scheduledAt,
    ),
    index("probe_checks_scheduled_idx").on(table.scheduledAt),
    check("probe_checks_attempt_check", sql`${table.attemptNo} >= 0`),
  ],
);

export const healthBuckets3h = pgTable(
  "health_buckets_3h",
  {
    providerModelId: uuid("provider_model_id")
      .notNull()
      .references(() => providerModels.id, { onDelete: "restrict" }),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    expectedCount: integer("expected_count").default(0).notNull(),
    attemptedCount: integer("attempted_count").default(0).notNull(),
    successCount: integer("success_count").default(0).notNull(),
    providerFailureCount: integer("provider_failure_count")
      .default(0)
      .notNull(),
    configurationErrorCount: integer("configuration_error_count")
      .default(0)
      .notNull(),
    observerErrorCount: integer("observer_error_count").default(0).notNull(),
    slowSuccessCount: integer("slow_success_count").default(0).notNull(),
    availabilityBps: integer("availability_bps"),
    coverageBps: integer("coverage_bps").default(0).notNull(),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "health_buckets_3h_pk",
      columns: [table.providerModelId, table.bucketStart],
    }),
    index("health_buckets_3h_start_idx").on(table.bucketStart),
    check(
      "health_buckets_3h_availability_check",
      sql`${table.availabilityBps} IS NULL OR ${table.availabilityBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "health_buckets_3h_coverage_check",
      sql`${table.coverageBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const providerModelStats = pgTable(
  "provider_model_stats",
  {
    providerModelId: uuid("provider_model_id")
      .primaryKey()
      .references(() => providerModels.id, { onDelete: "restrict" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    expectedCount: integer("expected_count").default(0).notNull(),
    successCount: integer("success_count").default(0).notNull(),
    providerFailureCount: integer("provider_failure_count")
      .default(0)
      .notNull(),
    sampleCount: integer("sample_count").default(0).notNull(),
    availabilityBps: integer("availability_bps"),
    coverageBps: integer("coverage_bps").default(0).notNull(),
    grade: availabilityGrade("grade"),
    currentStatus: currentStatus("current_status").default("unknown").notNull(),
    eligible: boolean("eligible").default(false).notNull(),
    eligibilityReason: text("eligibility_reason"),
    firstTokenP50Ms: integer("first_token_p50_ms"),
    firstTokenP95Ms: integer("first_token_p95_ms"),
    rankingScoreBps: integer("ranking_score_bps"),
    validBucketCount: smallint("valid_bucket_count").default(0).notNull(),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("provider_model_stats_ranking_idx").on(
      table.eligible,
      table.availabilityBps,
    ),
    index("provider_model_stats_ranking_score_idx").on(
      table.eligible,
      table.rankingScoreBps,
    ),
    check(
      "provider_model_stats_availability_check",
      sql`${table.availabilityBps} IS NULL OR ${table.availabilityBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "provider_model_stats_ranking_score_check",
      sql`${table.rankingScoreBps} IS NULL OR ${table.rankingScoreBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "provider_model_stats_coverage_check",
      sql`${table.coverageBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const sponsorships = pgTable(
  "sponsorships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerModelId: uuid("provider_model_id")
      .notNull()
      .references(() => providerModels.id, { onDelete: "restrict" }),
    slot: smallint("slot").default(1).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: sponsorshipStatus("status").default("draft").notNull(),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    ...timestamps,
  },
  (table) => [
    index("sponsorships_active_window_idx").on(
      table.status,
      table.startsAt,
      table.endsAt,
    ),
    index("sponsorships_provider_model_idx").on(table.providerModelId),
    check("sponsorships_slot_check", sql`${table.slot} > 0`),
    check(
      "sponsorships_window_check",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export type Provider = typeof providers.$inferSelect;
export type Model = typeof models.$inferSelect;
export type ProviderModel = typeof providerModels.$inferSelect;
export type ProbeTarget = typeof probeTargets.$inferSelect;
export type ProbeCheck = typeof probeChecks.$inferSelect;
export type HealthBucket3h = typeof healthBuckets3h.$inferSelect;
export type ProviderModelStats = typeof providerModelStats.$inferSelect;
export type Sponsorship = typeof sponsorships.$inferSelect;
export type MarketplaceSettings = typeof marketplaceSettings.$inferSelect;
export type HubProvider = typeof hubProviders.$inferSelect;
export type HubProviderGroup = typeof hubProviderGroups.$inferSelect;
export type HubGroupBlock = typeof hubGroupBlocks.$inferSelect;
export type HubGroupSecret = typeof hubGroupSecrets.$inferSelect;
export type HubModel = typeof hubModels.$inferSelect;
export type HubModelAlias = typeof hubModelAliases.$inferSelect;
export type HubModelPriceVersion = typeof hubModelPriceVersions.$inferSelect;
export type HubModelPriceComponent =
  typeof hubModelPriceComponents.$inferSelect;
export type HubGroupPriceVersion = typeof hubGroupPriceVersions.$inferSelect;
export type HubGroupModel = typeof hubGroupModels.$inferSelect;
export type HubConfigOutbox = typeof hubConfigOutbox.$inferSelect;
export type HubRelayChannelBinding =
  typeof hubRelayChannelBindings.$inferSelect;
export type HubProbeTarget = typeof hubProbeTargets.$inferSelect;
export type HubProbeCycle = typeof hubProbeCycles.$inferSelect;
export type HubProbeRun = typeof hubProbeRuns.$inferSelect;
export type HubHealthBucket3h = typeof hubHealthBuckets3h.$inferSelect;
export type HubGroupModelStat = typeof hubGroupModelStats.$inferSelect;
export type HubApiToken = typeof hubApiTokens.$inferSelect;
export type HubTokenGroupPreference =
  typeof hubTokenGroupPreferences.$inferSelect;
export type HubRequest = typeof hubRequests.$inferSelect;
export type HubRequestAttempt = typeof hubRequestAttempts.$inferSelect;
export type HubLedgerAccount = typeof hubLedgerAccounts.$inferSelect;
export type HubLedgerJournal = typeof hubLedgerJournals.$inferSelect;
export type HubLedgerLine = typeof hubLedgerLines.$inferSelect;
export type HubUsageRecord = typeof hubUsageRecords.$inferSelect;
export type HubBillingAuthorization =
  typeof hubBillingAuthorizations.$inferSelect;
