ALTER TABLE `radar_probe_target` ADD `model_not_found_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_probe_target` ADD `model_retired_at` integer;