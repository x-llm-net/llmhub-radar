CREATE TABLE `radar_claim_application` (
	`id` integer PRIMARY KEY NOT NULL,
	`pool_id` integer NOT NULL,
	`applicant_user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`proof` text(2000) NOT NULL,
	`review_note` text(1000),
	`reviewed_by_user_id` integer,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applicant_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `radar_claim_application_pool_status_idx` ON `radar_claim_application` (`pool_id`,`status`);--> statement-breakpoint
CREATE INDEX `radar_claim_application_applicant_status_idx` ON `radar_claim_application` (`applicant_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `radar_claim_application_created_idx` ON `radar_claim_application` (`created_at`);