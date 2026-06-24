ALTER TABLE `radar_probe_target` ADD `next_check_at` integer;--> statement-breakpoint
ALTER TABLE `radar_probe_target` ADD `last_check_started_at` integer;--> statement-breakpoint
ALTER TABLE `radar_probe_target` ADD `locked_until` integer;--> statement-breakpoint
CREATE INDEX `radar_probe_target_schedule_idx` ON `radar_probe_target` (`enabled`,`next_check_at`);