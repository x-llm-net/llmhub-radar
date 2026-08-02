CREATE TABLE "hub_config_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"config_version" integer NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_config_outbox_action_check" CHECK ("hub_config_outbox"."action" IN ('upsert', 'disable')),
	CONSTRAINT "hub_config_outbox_status_check" CHECK ("hub_config_outbox"."status" IN ('pending', 'processing', 'applied', 'failed')),
	CONSTRAINT "hub_config_outbox_counts_check" CHECK ("hub_config_outbox"."config_version" > 0 AND "hub_config_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hub_relay_channel_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"route_key" text NOT NULL,
	"external_channel_id" text NOT NULL,
	"applied_config_version" integer NOT NULL,
	"config_checksum" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_relay_channel_bindings_version_check" CHECK ("hub_relay_channel_bindings"."applied_config_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "hub_model_price_versions" ADD COLUMN "changed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "hub_model_price_versions" ADD COLUMN "change_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_provider_groups" ADD COLUMN "listing_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hub_provider_groups" ADD COLUMN "listing_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hub_provider_groups" ADD COLUMN "listing_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "hub_provider_groups" ADD COLUMN "listing_review_note" text;--> statement-breakpoint
ALTER TABLE "hub_config_outbox" ADD CONSTRAINT "hub_config_outbox_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_relay_channel_bindings" ADD CONSTRAINT "hub_relay_channel_bindings_group_id_hub_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hub_provider_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_config_outbox_group_version_uidx" ON "hub_config_outbox" USING btree ("group_id","config_version","action");--> statement-breakpoint
CREATE INDEX "hub_config_outbox_due_idx" ON "hub_config_outbox" USING btree ("status","next_attempt_at","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_relay_channel_bindings_route_uidx" ON "hub_relay_channel_bindings" USING btree ("group_id","route_key");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_relay_channel_bindings_external_uidx" ON "hub_relay_channel_bindings" USING btree ("external_channel_id");--> statement-breakpoint
CREATE INDEX "hub_relay_channel_bindings_group_idx" ON "hub_relay_channel_bindings" USING btree ("group_id");