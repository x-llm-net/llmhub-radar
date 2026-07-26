CREATE TABLE `radar_order` (
	`id` integer PRIMARY KEY NOT NULL,
	`order_number` text(40) NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`verification_application_id` integer,
	`pool_id` integer,
	`model_slug` text(160),
	`type` text NOT NULL,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text(8) DEFAULT 'CNY' NOT NULL,
	`receipt_asset_id` text(36),
	`review_note` text(1000),
	`reviewed_by_user_id` integer,
	`submitted_at` integer,
	`paid_at` integer,
	`activated_at` integer,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verification_application_id`) REFERENCES `radar_verification_application`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`receipt_asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `radar_order_number_idx` ON `radar_order` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `radar_order_verification_application_idx` ON `radar_order` (`verification_application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `radar_order_receipt_asset_idx` ON `radar_order` (`receipt_asset_id`);--> statement-breakpoint
CREATE INDEX `radar_order_user_created_idx` ON `radar_order` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `radar_order_status_created_idx` ON `radar_order` (`status`,`created_at`);