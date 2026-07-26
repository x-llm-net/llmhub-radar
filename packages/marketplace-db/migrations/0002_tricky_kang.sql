ALTER TABLE "probe_targets" DROP CONSTRAINT "probe_targets_source_config_check";--> statement-breakpoint
ALTER TABLE "probe_targets" ALTER COLUMN "api_key_fingerprint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "probe_targets" ALTER COLUMN "api_key_last_four" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "probe_targets" ADD CONSTRAINT "probe_targets_source_config_check" CHECK ((
        "probe_targets"."source" = 'legacy_radar' AND "probe_targets"."source_ref" IS NOT NULL
      ) OR (
        "probe_targets"."source" = 'native' AND
        "probe_targets"."endpoint_url" IS NOT NULL AND
        "probe_targets"."api_key_ciphertext" IS NOT NULL AND
        "probe_targets"."api_key_fingerprint" IS NOT NULL AND
        "probe_targets"."api_key_last_four" IS NOT NULL
      ));