CREATE TABLE `radar_credential` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`provider_id` integer NOT NULL,
	`name` text(120) NOT NULL,
	`description` text(500) DEFAULT '' NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`key_fingerprint` text(128) NOT NULL,
	`last_four` text(8) NOT NULL,
	`billing_group` text(120) DEFAULT '' NOT NULL,
	`model_group` text(120) DEFAULT '' NOT NULL,
	`daily_probe_limit` integer DEFAULT 288 NOT NULL,
	`daily_token_limit` integer DEFAULT 2000 NOT NULL,
	`daily_cost_limit_cents` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `radar_provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `radar_credential_workspace_id_idx` ON `radar_credential` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `radar_credential_provider_id_idx` ON `radar_credential` (`provider_id`);--> statement-breakpoint
CREATE TABLE `radar_pool` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text(120) NOT NULL,
	`slug` text(80) NOT NULL,
	`description` text(500) DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`public_pool_opt_in` integer DEFAULT false NOT NULL,
	`page_id` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `radar_pool_workspace_slug_idx` ON `radar_pool` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `radar_pool_workspace_id_idx` ON `radar_pool` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `radar_probe_run` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`pool_id` integer NOT NULL,
	`target_id` integer NOT NULL,
	`provider_id` integer NOT NULL,
	`credential_id_hash` text(128),
	`region` text(80) DEFAULT 'default' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`success` integer NOT NULL,
	`http_status` integer,
	`error_type` text,
	`safe_error_summary` text(500),
	`ttfb_ms` integer,
	`first_token_ms` integer,
	`total_latency_ms` integer,
	`tokens_in` integer,
	`tokens_out` integer,
	`tokens_per_second` integer,
	`estimated_cost_micros` integer,
	`prompt_template_version` text(40) DEFAULT 'health-v1' NOT NULL,
	`response_sample_hash` text(128),
	`trace_id` text(128),
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `radar_probe_target`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `radar_provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `radar_probe_run_target_started_idx` ON `radar_probe_run` (`target_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `radar_probe_run_workspace_started_idx` ON `radar_probe_run` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `radar_probe_target` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`pool_id` integer NOT NULL,
	`provider_id` integer NOT NULL,
	`credential_id` integer,
	`name` text(160) NOT NULL,
	`display_name` text(160) NOT NULL,
	`model_name` text(160) NOT NULL,
	`endpoint_type` text DEFAULT 'chat_completions' NOT NULL,
	`interval_seconds` integer DEFAULT 600 NOT NULL,
	`timeout_ms` integer DEFAULT 20000 NOT NULL,
	`max_tokens` integer DEFAULT 8 NOT NULL,
	`stream_enabled` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status_policy` text,
	`current_status` text DEFAULT 'unknown' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `radar_provider`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `radar_credential`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `radar_probe_target_workspace_id_idx` ON `radar_probe_target` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `radar_probe_target_pool_id_idx` ON `radar_probe_target` (`pool_id`);--> statement-breakpoint
CREATE INDEX `radar_probe_target_provider_id_idx` ON `radar_probe_target` (`provider_id`);--> statement-breakpoint
CREATE TABLE `radar_provider` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`pool_id` integer NOT NULL,
	`name` text(120) NOT NULL,
	`display_name` text(120) NOT NULL,
	`base_url_encrypted` text NOT NULL,
	`base_url_host_hash` text(128) NOT NULL,
	`base_url_visibility` text DEFAULT 'hidden' NOT NULL,
	`provider_type` text DEFAULT 'openai_compatible' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`notes` text(1000) DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `radar_provider_workspace_id_idx` ON `radar_provider` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `radar_provider_pool_id_idx` ON `radar_provider` (`pool_id`);--> statement-breakpoint
CREATE TABLE `radar_target_openstatus_binding` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`pool_id` integer NOT NULL,
	`target_id` integer NOT NULL,
	`page_id` integer,
	`monitor_id` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_id`) REFERENCES `radar_pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `radar_probe_target`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitor`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `radar_binding_target_id_idx` ON `radar_target_openstatus_binding` (`target_id`);--> statement-breakpoint
CREATE INDEX `radar_binding_workspace_id_idx` ON `radar_target_openstatus_binding` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `radar_binding_page_id_idx` ON `radar_target_openstatus_binding` (`page_id`);--> statement-breakpoint
CREATE TABLE `radar_target_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`target_id` integer NOT NULL,
	`sample_count_1h` integer DEFAULT 0 NOT NULL,
	`success_rate_1h` integer DEFAULT 0 NOT NULL,
	`sample_count_24h` integer DEFAULT 0 NOT NULL,
	`success_rate_24h` integer DEFAULT 0 NOT NULL,
	`p50_first_token_ms` integer,
	`p95_first_token_ms` integer,
	`p50_total_latency_ms` integer,
	`p95_total_latency_ms` integer,
	`error_count_by_type` text DEFAULT '{}',
	`last_check_at` integer,
	`last_success_at` integer,
	`last_failure_at` integer,
	`current_status` text DEFAULT 'unknown' NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `radar_probe_target`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `radar_target_status_target_id_idx` ON `radar_target_status` (`target_id`);--> statement-breakpoint
CREATE INDEX `radar_target_status_workspace_id_idx` ON `radar_target_status` (`workspace_id`);