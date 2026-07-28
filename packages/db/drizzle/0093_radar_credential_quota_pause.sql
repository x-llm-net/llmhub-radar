ALTER TABLE `radar_credential` ADD `pause_reason` text;--> statement-breakpoint
ALTER TABLE `radar_credential` ADD `auto_paused_at` integer;--> statement-breakpoint
ALTER TABLE `radar_credential` ADD `next_recovery_check_at` integer;