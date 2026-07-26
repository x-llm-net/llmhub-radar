CREATE TABLE `radar_verification_application` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`real_name` text(120),
	`company_name` text(200),
	`credit_code` text(64),
	`contact_name` text(120),
	`contact_qq` text(64) NOT NULL,
	`website_url` text(256) NOT NULL,
	`proof` text(2000) NOT NULL,
	`review_note` text(1000),
	`reviewed_by_user_id` integer,
	`reviewed_at` integer,
	`payment_confirmed_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `radar_verification_application_user_created_idx` ON `radar_verification_application` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `radar_verification_application_status_created_idx` ON `radar_verification_application` (`status`,`created_at`);