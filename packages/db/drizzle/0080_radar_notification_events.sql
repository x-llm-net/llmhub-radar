CREATE TABLE `radar_notification_event` (
  `id` integer PRIMARY KEY NOT NULL,
  `workspace_id` integer NOT NULL,
  `pool_id` integer NOT NULL,
  `target_id` integer NOT NULL,
  `page_id` integer,
  `run_id` integer,
  `event_type` text NOT NULL,
  `severity` text NOT NULL,
  `previous_status` text,
  `current_status` text NOT NULL,
  `title` text(180) NOT NULL,
  `message` text(1000) DEFAULT '' NOT NULL,
  `dedupe_key` text(200) NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_error` text(500),
  `created_at` integer DEFAULT (strftime('%s', 'now')),
  `dispatched_at` integer,
  `updated_at` integer DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`target_id`) REFERENCES `radar_probe_target`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`run_id`) REFERENCES `radar_probe_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `radar_notification_event_dedupe_idx` ON `radar_notification_event` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `radar_notification_event_status_created_idx` ON `radar_notification_event` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `radar_notification_event_target_idx` ON `radar_notification_event` (`target_id`);
--> statement-breakpoint
CREATE INDEX `radar_notification_event_page_idx` ON `radar_notification_event` (`page_id`);
