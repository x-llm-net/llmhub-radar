CREATE TABLE "marketplace_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"min_ranking_availability_bps" integer DEFAULT 8000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_settings_min_ranking_check" CHECK ("marketplace_settings"."min_ranking_availability_bps" BETWEEN 0 AND 10000)
);
