CREATE TYPE "public"."hub_probe_cycle_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."hub_probe_endpoint_type" AS ENUM('chat_completions');--> statement-breakpoint
CREATE TABLE "hub_group_model_stats" (
	"group_model_id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"availability_bps" integer,
	"coverage_bps" integer DEFAULT 0 NOT NULL,
	"grade" "availability_grade",
	"first_token_p50_ms" integer,
	"first_token_p95_ms" integer,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"valid_bucket_count" integer DEFAULT 0 NOT NULL,
	"ranking_score_bps" integer,
	"scoring_version" integer DEFAULT 1 NOT NULL,
	"current_status" "current_status" DEFAULT 'unknown' NOT NULL,
	"eligible" boolean DEFAULT false NOT NULL,
	"eligibility_reason" text,
	"last_check_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_group_model_stats_window_check" CHECK ("hub_group_model_stats"."window_end" > "hub_group_model_stats"."window_start"),
	CONSTRAINT "hub_group_model_stats_ratios_check" CHECK (("hub_group_model_stats"."availability_bps" IS NULL OR "hub_group_model_stats"."availability_bps" BETWEEN 0 AND 10000) AND "hub_group_model_stats"."coverage_bps" BETWEEN 0 AND 10000 AND ("hub_group_model_stats"."ranking_score_bps" IS NULL OR "hub_group_model_stats"."ranking_score_bps" BETWEEN 0 AND 10000)),
	CONSTRAINT "hub_group_model_stats_counts_check" CHECK ("hub_group_model_stats"."sample_count" >= 0 AND "hub_group_model_stats"."valid_bucket_count" >= 0 AND "hub_group_model_stats"."scoring_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "hub_health_buckets_3h" (
	"group_model_id" uuid NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_health_buckets_3h_pk" PRIMARY KEY("group_model_id","bucket_start"),
	CONSTRAINT "hub_health_buckets_3h_counts_check" CHECK ("hub_health_buckets_3h"."expected_count" >= 0 AND "hub_health_buckets_3h"."attempted_count" >= 0 AND "hub_health_buckets_3h"."success_count" >= 0 AND "hub_health_buckets_3h"."provider_failure_count" >= 0 AND "hub_health_buckets_3h"."configuration_error_count" >= 0 AND "hub_health_buckets_3h"."observer_error_count" >= 0 AND "hub_health_buckets_3h"."slow_success_count" >= 0),
	CONSTRAINT "hub_health_buckets_3h_ratios_check" CHECK (("hub_health_buckets_3h"."availability_bps" IS NULL OR "hub_health_buckets_3h"."availability_bps" BETWEEN 0 AND 10000) AND "hub_health_buckets_3h"."coverage_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "hub_probe_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "hub_probe_cycle_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_probe_runs" (
	"target_id" uuid NOT NULL,
	"group_model_id" uuid NOT NULL,
	"probe_cycle_id" uuid NOT NULL,
	"attempt_no" smallint DEFAULT 0 NOT NULL,
	"outcome" "probe_outcome" NOT NULL,
	"http_status" integer,
	"error_code" text,
	"safe_error_summary" text,
	"ttfb_ms" integer,
	"first_token_ms" integer,
	"total_latency_ms" integer NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"upstream_request_id" text,
	"config_version" integer NOT NULL,
	"secret_version" integer NOT NULL,
	"key_fingerprint" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_probe_runs_pk" PRIMARY KEY("target_id","probe_cycle_id","attempt_no","scheduled_at"),
	CONSTRAINT "hub_probe_runs_attempt_check" CHECK ("hub_probe_runs"."attempt_no" >= 0),
	CONSTRAINT "hub_probe_runs_config_check" CHECK ("hub_probe_runs"."config_version" > 0),
	CONSTRAINT "hub_probe_runs_latency_check" CHECK ("hub_probe_runs"."total_latency_ms" >= 0),
	CONSTRAINT "hub_probe_runs_time_check" CHECK ("hub_probe_runs"."completed_at" >= "hub_probe_runs"."started_at")
) PARTITION BY RANGE ("scheduled_at");
--> statement-breakpoint
CREATE TABLE "hub_probe_runs_2026_08" PARTITION OF "hub_probe_runs" FOR VALUES FROM ('2026-08-01T00:00:00Z') TO ('2026-09-01T00:00:00Z');
--> statement-breakpoint
CREATE TABLE "hub_probe_runs_2026_09" PARTITION OF "hub_probe_runs" FOR VALUES FROM ('2026-09-01T00:00:00Z') TO ('2026-10-01T00:00:00Z');
--> statement-breakpoint
CREATE TABLE "hub_probe_runs_default" PARTITION OF "hub_probe_runs" DEFAULT;
--> statement-breakpoint
CREATE TABLE "hub_probe_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_model_id" uuid NOT NULL,
	"endpoint_type" "hub_probe_endpoint_type" DEFAULT 'chat_completions' NOT NULL,
	"interval_seconds" integer DEFAULT 600 NOT NULL,
	"timeout_ms" integer DEFAULT 20000 NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"model_not_found_count" integer DEFAULT 0 NOT NULL,
	"last_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_probe_targets_interval_check" CHECK ("hub_probe_targets"."interval_seconds" BETWEEN 60 AND 86400),
	CONSTRAINT "hub_probe_targets_timeout_check" CHECK ("hub_probe_targets"."timeout_ms" BETWEEN 1000 AND 120000),
	CONSTRAINT "hub_probe_targets_model_not_found_check" CHECK ("hub_probe_targets"."model_not_found_count" >= 0),
	CONSTRAINT "hub_probe_targets_lease_check" CHECK ((
        ("hub_probe_targets"."lease_token" IS NULL AND "hub_probe_targets"."locked_by" IS NULL AND "hub_probe_targets"."locked_until" IS NULL) OR
        ("hub_probe_targets"."lease_token" IS NOT NULL AND "hub_probe_targets"."locked_by" IS NOT NULL AND "hub_probe_targets"."locked_until" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "hub_group_model_stats" ADD CONSTRAINT "hub_group_model_stats_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_health_buckets_3h" ADD CONSTRAINT "hub_health_buckets_3h_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_probe_cycles" ADD CONSTRAINT "hub_probe_cycles_target_id_hub_probe_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."hub_probe_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_probe_runs" ADD CONSTRAINT "hub_probe_runs_target_id_hub_probe_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."hub_probe_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_probe_runs" ADD CONSTRAINT "hub_probe_runs_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_probe_runs" ADD CONSTRAINT "hub_probe_runs_probe_cycle_id_hub_probe_cycles_id_fk" FOREIGN KEY ("probe_cycle_id") REFERENCES "public"."hub_probe_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_probe_targets" ADD CONSTRAINT "hub_probe_targets_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_group_model_stats_ranking_idx" ON "hub_group_model_stats" USING btree ("eligible","ranking_score_bps");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_probe_cycles_target_schedule_uidx" ON "hub_probe_cycles" USING btree ("target_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "hub_probe_cycles_status_idx" ON "hub_probe_cycles" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "hub_probe_runs_group_model_schedule_idx" ON "hub_probe_runs" USING btree ("group_model_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_probe_targets_group_model_uidx" ON "hub_probe_targets" USING btree ("group_model_id");--> statement-breakpoint
CREATE INDEX "hub_probe_targets_due_idx" ON "hub_probe_targets" USING btree ("enabled","next_check_at","locked_until");
