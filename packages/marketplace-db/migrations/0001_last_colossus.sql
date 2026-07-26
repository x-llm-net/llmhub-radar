CREATE TYPE "public"."probe_target_source" AS ENUM('native', 'legacy_radar');--> statement-breakpoint
ALTER TABLE "probe_targets" ALTER COLUMN "endpoint_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "probe_targets" ALTER COLUMN "api_key_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "probe_targets" ADD COLUMN "source" "probe_target_source" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "probe_targets" ADD COLUMN "source_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "probe_targets_source_ref_uidx" ON "probe_targets" USING btree ("source","source_ref");--> statement-breakpoint
ALTER TABLE "probe_targets" ADD CONSTRAINT "probe_targets_source_config_check" CHECK ((
        "probe_targets"."source" = 'legacy_radar' AND "probe_targets"."source_ref" IS NOT NULL
      ) OR (
        "probe_targets"."source" = 'native' AND
        "probe_targets"."endpoint_url" IS NOT NULL AND
        "probe_targets"."api_key_ciphertext" IS NOT NULL
      ));