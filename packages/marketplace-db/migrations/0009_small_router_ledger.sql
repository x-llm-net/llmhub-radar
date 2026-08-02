CREATE TYPE "public"."hub_api_token_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."hub_request_status" AS ENUM('planned', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."hub_route_attempt_outcome" AS ENUM('success', 'provider_failure', 'configuration_error', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."hub_usage_status" AS ENUM('posted', 'void');--> statement-breakpoint
CREATE TYPE "public"."hub_ledger_account_type" AS ENUM('user_credit', 'provider_payable', 'platform_revenue', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."hub_ledger_journal_status" AS ENUM('posted', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."hub_ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "hub_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "hub_api_token_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"routing_revision" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_api_tokens_revision_check" CHECK ("hub_api_tokens"."routing_revision" > 0)
);--> statement-breakpoint
CREATE TABLE "hub_token_group_preferences" (
	"token_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_token_group_preferences_pk" PRIMARY KEY("token_id","group_id"),
	CONSTRAINT "hub_token_group_preferences_priority_check" CHECK ("hub_token_group_preferences"."priority" >= 0),
	CONSTRAINT "hub_token_group_preferences_weight_check" CHECK ("hub_token_group_preferences"."weight" >= 0)
);--> statement-breakpoint
CREATE TABLE "hub_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"token_id" uuid NOT NULL,
	"canonical_model_id" uuid NOT NULL,
	"route_plan_version" integer NOT NULL,
	"route_plan" jsonb NOT NULL,
	"status" "hub_request_status" DEFAULT 'planned' NOT NULL,
	"final_group_model_id" uuid,
	"external_request_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_requests_route_plan_version_check" CHECK ("hub_requests"."route_plan_version" > 0)
);--> statement-breakpoint
CREATE TABLE "hub_request_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"attempt_no" smallint NOT NULL,
	"group_model_id" uuid NOT NULL,
	"relay_channel_binding_id" uuid,
	"external_channel_id" text,
	"config_version" integer NOT NULL,
	"outcome" "hub_route_attempt_outcome" NOT NULL,
	"error_code" text,
	"upstream_request_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_request_attempts_no_check" CHECK ("hub_request_attempts"."attempt_no" >= 0),
	CONSTRAINT "hub_request_attempts_version_check" CHECK ("hub_request_attempts"."config_version" > 0)
);--> statement-breakpoint
CREATE TABLE "hub_ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_key" text NOT NULL,
	"account_type" "hub_ledger_account_type" NOT NULL,
	"owner_id" text,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "hub_ledger_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_type" text NOT NULL,
	"currency" text NOT NULL,
	"source_type" text,
	"source_id" text,
	"status" "hub_ledger_journal_status" DEFAULT 'posted' NOT NULL,
	"reversal_of_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "hub_ledger_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"direction" "hub_ledger_direction" NOT NULL,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_ledger_lines_no_check" CHECK ("hub_ledger_lines"."line_no" > 0),
	CONSTRAINT "hub_ledger_lines_amount_check" CHECK ("hub_ledger_lines"."amount_micros" > 0)
);--> statement-breakpoint
CREATE TABLE "hub_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_event_id" text NOT NULL,
	"token_id" uuid NOT NULL,
	"final_group_model_id" uuid NOT NULL,
	"model_price_version_id" uuid,
	"group_price_version_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"user_amount_micros" bigint NOT NULL,
	"provider_payout_micros" bigint NOT NULL,
	"platform_fee_micros" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "hub_usage_status" DEFAULT 'posted' NOT NULL,
	"ledger_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_usage_records_tokens_check" CHECK ("hub_usage_records"."input_tokens" >= 0 AND "hub_usage_records"."output_tokens" >= 0 AND "hub_usage_records"."cache_read_tokens" >= 0 AND "hub_usage_records"."cache_write_tokens" >= 0),
	CONSTRAINT "hub_usage_records_amounts_check" CHECK ("hub_usage_records"."user_amount_micros" >= 0 AND "hub_usage_records"."provider_payout_micros" >= 0 AND "hub_usage_records"."platform_fee_micros" >= 0)
);--> statement-breakpoint
ALTER TABLE "hub_token_group_preferences" ADD CONSTRAINT "hub_token_group_preferences_token_id_hub_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."hub_api_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_token_group_preferences" ADD CONSTRAINT "hub_token_group_preferences_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_requests" ADD CONSTRAINT "hub_requests_token_id_hub_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."hub_api_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_requests" ADD CONSTRAINT "hub_requests_canonical_model_id_hub_models_id_fk" FOREIGN KEY ("canonical_model_id") REFERENCES "public"."hub_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_requests" ADD CONSTRAINT "hub_requests_final_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("final_group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_request_attempts" ADD CONSTRAINT "hub_request_attempts_request_id_hub_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hub_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_request_attempts" ADD CONSTRAINT "hub_request_attempts_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_request_attempts" ADD CONSTRAINT "hub_request_attempts_relay_channel_binding_id_hub_relay_channel_bindings_id_fk" FOREIGN KEY ("relay_channel_binding_id") REFERENCES "public"."hub_relay_channel_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_ledger_lines" ADD CONSTRAINT "hub_ledger_lines_journal_id_hub_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."hub_ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_ledger_lines" ADD CONSTRAINT "hub_ledger_lines_account_id_hub_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."hub_ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_usage_records" ADD CONSTRAINT "hub_usage_records_request_id_hub_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hub_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_usage_records" ADD CONSTRAINT "hub_usage_records_token_id_hub_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."hub_api_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_usage_records" ADD CONSTRAINT "hub_usage_records_final_group_model_id_hub_group_models_id_fk" FOREIGN KEY ("final_group_model_id") REFERENCES "public"."hub_group_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_usage_records" ADD CONSTRAINT "hub_usage_records_model_price_version_id_hub_model_price_versions_id_fk" FOREIGN KEY ("model_price_version_id") REFERENCES "public"."hub_model_price_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_usage_records" ADD CONSTRAINT "hub_usage_records_group_price_version_id_hub_group_price_versions_id_fk" FOREIGN KEY ("group_price_version_id") REFERENCES "public"."hub_group_price_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_usage_records" ADD CONSTRAINT "hub_usage_records_ledger_journal_id_hub_ledger_journals_id_fk" FOREIGN KEY ("ledger_journal_id") REFERENCES "public"."hub_ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_api_tokens_hash_uidx" ON "hub_api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "hub_api_tokens_owner_status_idx" ON "hub_api_tokens" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "hub_token_group_preferences_group_idx" ON "hub_token_group_preferences" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "hub_requests_owner_created_idx" ON "hub_requests" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "hub_requests_token_created_idx" ON "hub_requests" USING btree ("token_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_request_attempts_request_no_uidx" ON "hub_request_attempts" USING btree ("request_id","attempt_no");--> statement-breakpoint
CREATE INDEX "hub_request_attempts_group_created_idx" ON "hub_request_attempts" USING btree ("group_model_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_ledger_accounts_key_uidx" ON "hub_ledger_accounts" USING btree ("account_key");--> statement-breakpoint
CREATE INDEX "hub_ledger_accounts_owner_idx" ON "hub_ledger_accounts" USING btree ("owner_id","account_type");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_ledger_journals_idempotency_uidx" ON "hub_ledger_journals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "hub_ledger_journals_source_idx" ON "hub_ledger_journals" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_ledger_lines_journal_no_uidx" ON "hub_ledger_lines" USING btree ("journal_id","line_no");--> statement-breakpoint
CREATE INDEX "hub_ledger_lines_account_idx" ON "hub_ledger_lines" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_usage_records_request_uidx" ON "hub_usage_records" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_usage_records_source_uidx" ON "hub_usage_records" USING btree ("source_system","source_event_id");--> statement-breakpoint
CREATE INDEX "hub_usage_records_token_created_idx" ON "hub_usage_records" USING btree ("token_id","created_at");
