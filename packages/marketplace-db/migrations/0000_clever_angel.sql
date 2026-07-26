CREATE TYPE "public"."availability_grade" AS ENUM('S', 'A', 'B', 'C', 'D');--> statement-breakpoint
CREATE TYPE "public"."current_status" AS ENUM('unknown', 'normal', 'degraded', 'down', 'configuration_error', 'stale');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'observing', 'ranked', 'suspended', 'retired');--> statement-breakpoint
CREATE TYPE "public"."probe_outcome" AS ENUM('success', 'provider_failure', 'configuration_error', 'observer_error');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('draft', 'observing', 'published', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."sponsorship_status" AS ENUM('draft', 'scheduled', 'active', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "health_buckets_3h" (
	"provider_model_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"attempted_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"provider_failure_count" integer DEFAULT 0 NOT NULL,
	"configuration_error_count" integer DEFAULT 0 NOT NULL,
	"observer_error_count" integer DEFAULT 0 NOT NULL,
	"slow_success_count" integer DEFAULT 0 NOT NULL,
	"availability_bps" integer,
	"coverage_bps" integer DEFAULT 0 NOT NULL,
	"last_check_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_buckets_3h_pk" PRIMARY KEY("provider_model_id","bucket_start"),
	CONSTRAINT "health_buckets_3h_availability_check" CHECK ("health_buckets_3h"."availability_bps" IS NULL OR "health_buckets_3h"."availability_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "health_buckets_3h_coverage_check" CHECK ("health_buckets_3h"."coverage_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"vendor" text NOT NULL,
	"family" text NOT NULL,
	"display_name" text NOT NULL,
	"short_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probe_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target_id" uuid NOT NULL,
	"provider_model_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"attempt_no" smallint DEFAULT 0 NOT NULL,
	"outcome" "probe_outcome" NOT NULL,
	"error_code" text,
	"safe_error_summary" text,
	"http_status" integer,
	"first_token_ms" integer,
	"total_latency_ms" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"response_sample_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "probe_checks_attempt_check" CHECK ("probe_checks"."attempt_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "probe_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_model_id" uuid NOT NULL,
	"name" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"endpoint_type" text DEFAULT 'openai_compatible' NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"api_key_fingerprint" text NOT NULL,
	"api_key_last_four" text NOT NULL,
	"interval_seconds" integer DEFAULT 600 NOT NULL,
	"timeout_ms" integer DEFAULT 20000 NOT NULL,
	"is_scoring" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "probe_targets_interval_check" CHECK ("probe_targets"."interval_seconds" >= 60),
	CONSTRAINT "probe_targets_timeout_check" CHECK ("probe_targets"."timeout_ms" >= 1000)
);
--> statement-breakpoint
CREATE TABLE "provider_model_stats" (
	"provider_model_id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"provider_failure_count" integer DEFAULT 0 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"availability_bps" integer,
	"coverage_bps" integer DEFAULT 0 NOT NULL,
	"grade" "availability_grade",
	"current_status" "current_status" DEFAULT 'unknown' NOT NULL,
	"eligible" boolean DEFAULT false NOT NULL,
	"eligibility_reason" text,
	"first_token_p95_ms" integer,
	"valid_bucket_count" smallint DEFAULT 0 NOT NULL,
	"last_check_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_model_stats_availability_check" CHECK ("provider_model_stats"."availability_bps" IS NULL OR "provider_model_stats"."availability_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "provider_model_stats_coverage_check" CHECK ("provider_model_stats"."coverage_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"provider_model_name" text NOT NULL,
	"purchase_url" text,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website_url" text,
	"logo_url" text,
	"status" "provider_status" DEFAULT 'draft' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_model_id" uuid NOT NULL,
	"slot" smallint DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "sponsorship_status" DEFAULT 'draft' NOT NULL,
	"cta_label" text,
	"cta_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsorships_slot_check" CHECK ("sponsorships"."slot" > 0),
	CONSTRAINT "sponsorships_window_check" CHECK ("sponsorships"."ends_at" > "sponsorships"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "health_buckets_3h" ADD CONSTRAINT "health_buckets_3h_provider_model_id_provider_models_id_fk" FOREIGN KEY ("provider_model_id") REFERENCES "public"."provider_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_checks" ADD CONSTRAINT "probe_checks_target_id_probe_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."probe_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_checks" ADD CONSTRAINT "probe_checks_provider_model_id_provider_models_id_fk" FOREIGN KEY ("provider_model_id") REFERENCES "public"."provider_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_targets" ADD CONSTRAINT "probe_targets_provider_model_id_provider_models_id_fk" FOREIGN KEY ("provider_model_id") REFERENCES "public"."provider_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_model_stats" ADD CONSTRAINT "provider_model_stats_provider_model_id_provider_models_id_fk" FOREIGN KEY ("provider_model_id") REFERENCES "public"."provider_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_models" ADD CONSTRAINT "provider_models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_models" ADD CONSTRAINT "provider_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_provider_model_id_provider_models_id_fk" FOREIGN KEY ("provider_model_id") REFERENCES "public"."provider_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_buckets_3h_start_idx" ON "health_buckets_3h" USING btree ("bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "models_slug_uidx" ON "models" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "models_catalog_idx" ON "models" USING btree ("enabled","vendor","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "probe_checks_episode_attempt_uidx" ON "probe_checks" USING btree ("target_id","scheduled_at","attempt_no");--> statement-breakpoint
CREATE INDEX "probe_checks_provider_model_scheduled_idx" ON "probe_checks" USING btree ("provider_model_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "probe_checks_target_scheduled_idx" ON "probe_checks" USING btree ("target_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "probe_checks_scheduled_idx" ON "probe_checks" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "probe_targets_active_scoring_uidx" ON "probe_targets" USING btree ("provider_model_id") WHERE "probe_targets"."is_scoring" AND "probe_targets"."enabled";--> statement-breakpoint
CREATE INDEX "probe_targets_schedule_idx" ON "probe_targets" USING btree ("enabled","next_check_at");--> statement-breakpoint
CREATE INDEX "probe_targets_provider_model_idx" ON "probe_targets" USING btree ("provider_model_id");--> statement-breakpoint
CREATE INDEX "provider_model_stats_ranking_idx" ON "provider_model_stats" USING btree ("eligible","availability_bps");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_models_provider_model_uidx" ON "provider_models" USING btree ("provider_id","model_id");--> statement-breakpoint
CREATE INDEX "provider_models_model_status_idx" ON "provider_models" USING btree ("model_id","status");--> statement-breakpoint
CREATE INDEX "provider_models_provider_idx" ON "provider_models" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_slug_uidx" ON "providers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "providers_status_idx" ON "providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sponsorships_active_window_idx" ON "sponsorships" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "sponsorships_provider_model_idx" ON "sponsorships" USING btree ("provider_model_id");