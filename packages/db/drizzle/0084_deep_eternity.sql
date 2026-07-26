ALTER TABLE `radar_pool` ADD `pricing_url` text(256);
--> statement-breakpoint
ALTER TABLE `radar_pool` ADD `redirect_url_template` text(256);
--> statement-breakpoint
ALTER TABLE `radar_pool` ADD `contact_qq` text(64);
--> statement-breakpoint
ALTER TABLE `radar_pool` ALTER COLUMN "description" TO "description" text(5000) NOT NULL DEFAULT '';
