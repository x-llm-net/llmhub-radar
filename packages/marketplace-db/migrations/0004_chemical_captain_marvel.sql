CREATE TYPE "public"."model_visibility" AS ENUM('auto', 'show', 'hide');--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "visibility" "model_visibility" DEFAULT 'auto' NOT NULL;