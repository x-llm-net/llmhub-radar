CREATE TABLE `media_asset` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`owner_user_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`storage_key` text(160) NOT NULL,
	`original_filename` text(255) NOT NULL,
	`mime_type` text(100) NOT NULL,
	`size_bytes` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_asset_storage_key_idx` ON `media_asset` (`storage_key`);--> statement-breakpoint
CREATE INDEX `media_asset_owner_expiry_idx` ON `media_asset` (`owner_user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `media_asset_workspace_purpose_idx` ON `media_asset` (`workspace_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `media_asset_expiry_idx` ON `media_asset` (`expires_at`);--> statement-breakpoint
CREATE TABLE `radar_claim_application_evidence` (
	`application_id` integer NOT NULL,
	`asset_id` text(36) NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	PRIMARY KEY(`application_id`, `asset_id`),
	FOREIGN KEY (`application_id`) REFERENCES `radar_claim_application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `radar_claim_evidence_application_order_idx` ON `radar_claim_application_evidence` (`application_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `radar_claim_evidence_asset_idx` ON `radar_claim_application_evidence` (`asset_id`);