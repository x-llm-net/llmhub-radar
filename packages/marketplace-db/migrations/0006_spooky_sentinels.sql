CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TYPE "public"."hub_balance_status" AS ENUM('unknown', 'available', 'low', 'exhausted', 'error');--> statement-breakpoint
CREATE TYPE "public"."hub_billing_mode" AS ENUM('token', 'per_request', 'component', 'tiered');--> statement-breakpoint
CREATE TYPE "public"."hub_group_block_source" AS ENUM('manual', 'balance', 'auth', 'health', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."hub_group_desired_status" AS ENUM('active', 'paused', 'retired');--> statement-breakpoint
CREATE TYPE "public"."hub_group_lifecycle_status" AS ENUM('draft', 'verifying', 'ready', 'retired');--> statement-breakpoint
CREATE TYPE "public"."hub_group_listing_status" AS ENUM('private', 'pending', 'listed', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."hub_group_model_discovery_status" AS ENUM('unmapped', 'active', 'missing', 'retired');--> statement-breakpoint
CREATE TYPE "public"."hub_model_status" AS ENUM('active', 'deprecated', 'retired');--> statement-breakpoint
CREATE TYPE "public"."hub_price_component_kind" AS ENUM('input_text', 'output_text', 'cache_read', 'cache_write', 'input_audio', 'output_audio', 'image', 'request', 'other');--> statement-breakpoint
CREATE TYPE "public"."hub_price_unit" AS ENUM('million_tokens', 'thousand_tokens', 'image', 'second', 'request', 'unit');--> statement-breakpoint
CREATE TYPE "public"."hub_provider_management_mode" AS ENUM('platform_managed', 'provider_managed');--> statement-breakpoint
CREATE TYPE "public"."hub_provider_status" AS ENUM('draft', 'active', 'suspended', 'retired');--> statement-breakpoint
CREATE TABLE "hub_group_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"source" "hub_group_block_source" NOT NULL,
	"reason_code" text NOT NULL,
	"stops_traffic" boolean DEFAULT true NOT NULL,
	"stops_probes" boolean DEFAULT false NOT NULL,
	"auto_clear" boolean DEFAULT false NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hub_group_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"model_id" uuid,
	"upstream_model_name" text NOT NULL,
	"normalized_upstream_name" text NOT NULL,
	"base_url_override_ciphertext" text,
	"base_url_override_host_hash" text,
	"discovery_status" "hub_group_model_discovery_status" DEFAULT 'unmapped' NOT NULL,
	"traffic_enabled" boolean DEFAULT false NOT NULL,
	"probe_enabled" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_group_models_mapping_check" CHECK ((
        ("hub_group_models"."model_id" IS NOT NULL AND "hub_group_models"."discovery_status" <> 'unmapped') OR
        (NOT "hub_group_models"."traffic_enabled" AND NOT "hub_group_models"."probe_enabled")
      )),
	CONSTRAINT "hub_group_models_missing_count_check" CHECK ("hub_group_models"."missing_count" >= 0),
	CONSTRAINT "hub_group_models_base_url_override_check" CHECK ((
        ("hub_group_models"."base_url_override_ciphertext" IS NULL AND "hub_group_models"."base_url_override_host_hash" IS NULL) OR
        ("hub_group_models"."base_url_override_ciphertext" IS NOT NULL AND "hub_group_models"."base_url_override_host_hash" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "hub_group_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"multiplier_bps" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"changed_by_user_id" text,
	"change_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_group_price_versions_multiplier_check" CHECK ("hub_group_price_versions"."multiplier_bps" >= 0),
	CONSTRAINT "hub_group_price_versions_window_check" CHECK ("hub_group_price_versions"."effective_to" IS NULL OR "hub_group_price_versions"."effective_to" > "hub_group_price_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "hub_group_secrets" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"last_four" text NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_group_secrets_version_check" CHECK ("hub_group_secrets"."secret_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "hub_model_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"namespace" text DEFAULT 'global' NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_model_price_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_version_id" uuid NOT NULL,
	"component" "hub_price_component_kind" NOT NULL,
	"unit" "hub_price_unit" NOT NULL,
	"unit_size" integer DEFAULT 1 NOT NULL,
	"amount_micros" bigint NOT NULL,
	"tier_key" text DEFAULT 'default' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_model_price_components_unit_size_check" CHECK ("hub_model_price_components"."unit_size" > 0),
	CONSTRAINT "hub_model_price_components_amount_check" CHECK ("hub_model_price_components"."amount_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hub_model_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"billing_mode" "hub_billing_mode" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source" text NOT NULL,
	"source_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_model_price_versions_window_check" CHECK ("hub_model_price_versions"."effective_to" IS NULL OR "hub_model_price_versions"."effective_to" > "hub_model_price_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "hub_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"vendor" text NOT NULL,
	"family" text NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"short_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"capabilities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" "hub_model_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_provider_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_url_ciphertext" text NOT NULL,
	"base_url_host_hash" text NOT NULL,
	"lifecycle_status" "hub_group_lifecycle_status" DEFAULT 'draft' NOT NULL,
	"desired_status" "hub_group_desired_status" DEFAULT 'active' NOT NULL,
	"listing_status" "hub_group_listing_status" DEFAULT 'private' NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"last_balance_micros" bigint,
	"balance_currency" text,
	"balance_status" "hub_balance_status" DEFAULT 'unknown' NOT NULL,
	"balance_checked_at" timestamp with time zone,
	"balance_stale_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_provider_groups_config_version_check" CHECK ("hub_provider_groups"."config_version" > 0),
	CONSTRAINT "hub_provider_groups_balance_check" CHECK ((
        ("hub_provider_groups"."last_balance_micros" IS NULL AND "hub_provider_groups"."balance_currency" IS NULL) OR
        ("hub_provider_groups"."last_balance_micros" >= 0 AND "hub_provider_groups"."balance_currency" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "hub_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_workspace_id" text,
	"management_mode" "hub_provider_management_mode" DEFAULT 'provider_managed' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website_url" text,
	"logo_asset_id" text,
	"claimable" boolean DEFAULT false NOT NULL,
	"status" "hub_provider_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_providers_owner_check" CHECK ((
        "hub_providers"."management_mode" = 'platform_managed' OR
        "hub_providers"."owner_workspace_id" IS NOT NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "hub_group_blocks" ADD CONSTRAINT "hub_group_blocks_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_group_models" ADD CONSTRAINT "hub_group_models_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_group_models" ADD CONSTRAINT "hub_group_models_model_id_hub_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."hub_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_group_price_versions" ADD CONSTRAINT "hub_group_price_versions_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_group_secrets" ADD CONSTRAINT "hub_group_secrets_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_model_aliases" ADD CONSTRAINT "hub_model_aliases_model_id_hub_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."hub_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_model_price_components" ADD CONSTRAINT "hub_model_price_components_price_version_id_hub_model_price_versions_id_fk" FOREIGN KEY ("price_version_id") REFERENCES "public"."hub_model_price_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_model_price_versions" ADD CONSTRAINT "hub_model_price_versions_model_id_hub_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."hub_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_provider_groups" ADD CONSTRAINT "hub_provider_groups_provider_id_hub_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."hub_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_group_blocks_active_uidx" ON "hub_group_blocks" USING btree ("group_id","source","reason_code") WHERE "hub_group_blocks"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "hub_group_blocks_group_active_idx" ON "hub_group_blocks" USING btree ("group_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_group_models_upstream_name_uidx" ON "hub_group_models" USING btree ("group_id","normalized_upstream_name");--> statement-breakpoint
CREATE INDEX "hub_group_models_group_status_idx" ON "hub_group_models" USING btree ("group_id","discovery_status");--> statement-breakpoint
CREATE INDEX "hub_group_models_model_status_idx" ON "hub_group_models" USING btree ("model_id","discovery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_group_price_versions_start_uidx" ON "hub_group_price_versions" USING btree ("group_id","effective_from");--> statement-breakpoint
CREATE INDEX "hub_group_price_versions_current_idx" ON "hub_group_price_versions" USING btree ("group_id","effective_to");--> statement-breakpoint
CREATE INDEX "hub_group_secrets_fingerprint_idx" ON "hub_group_secrets" USING btree ("key_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_model_aliases_namespace_alias_uidx" ON "hub_model_aliases" USING btree ("namespace","normalized_alias");--> statement-breakpoint
CREATE INDEX "hub_model_aliases_model_idx" ON "hub_model_aliases" USING btree ("model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_model_price_components_identity_uidx" ON "hub_model_price_components" USING btree ("price_version_id","component","unit","tier_key");--> statement-breakpoint
CREATE INDEX "hub_model_price_components_version_idx" ON "hub_model_price_components" USING btree ("price_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_model_price_versions_start_uidx" ON "hub_model_price_versions" USING btree ("model_id","currency","effective_from");--> statement-breakpoint
CREATE INDEX "hub_model_price_versions_current_idx" ON "hub_model_price_versions" USING btree ("model_id","currency","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_models_slug_uidx" ON "hub_models" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_models_canonical_name_uidx" ON "hub_models" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "hub_models_catalog_idx" ON "hub_models" USING btree ("status","vendor","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_provider_groups_provider_name_uidx" ON "hub_provider_groups" USING btree ("provider_id","name");--> statement-breakpoint
CREATE INDEX "hub_provider_groups_provider_idx" ON "hub_provider_groups" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "hub_provider_groups_runtime_idx" ON "hub_provider_groups" USING btree ("lifecycle_status","desired_status","listing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_providers_slug_uidx" ON "hub_providers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "hub_providers_owner_idx" ON "hub_providers" USING btree ("owner_workspace_id");--> statement-breakpoint
CREATE INDEX "hub_providers_status_idx" ON "hub_providers" USING btree ("status");--> statement-breakpoint
ALTER TABLE "hub_model_price_versions" ADD CONSTRAINT "hub_model_price_versions_no_overlap_excl" EXCLUDE USING gist (
	"model_id" WITH =,
	"currency" WITH =,
	tstzrange("effective_from", "effective_to", '[)') WITH &&
) DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "hub_group_price_versions" ADD CONSTRAINT "hub_group_price_versions_no_overlap_excl" EXCLUDE USING gist (
	"group_id" WITH =,
	tstzrange("effective_from", "effective_to", '[)') WITH &&
) DEFERRABLE INITIALLY IMMEDIATE;
