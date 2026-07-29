ALTER TABLE "provider_model_stats" ADD COLUMN "first_token_p50_ms" integer;--> statement-breakpoint
ALTER TABLE "provider_model_stats" ADD COLUMN "ranking_score_bps" integer;--> statement-breakpoint
CREATE INDEX "provider_model_stats_ranking_score_idx" ON "provider_model_stats" USING btree ("eligible","ranking_score_bps");--> statement-breakpoint
ALTER TABLE "provider_model_stats" ADD CONSTRAINT "provider_model_stats_ranking_score_check" CHECK ("provider_model_stats"."ranking_score_bps" IS NULL OR "provider_model_stats"."ranking_score_bps" BETWEEN 0 AND 10000);
