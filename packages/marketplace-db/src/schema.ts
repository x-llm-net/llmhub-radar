import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
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
