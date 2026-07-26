CREATE TABLE `radar_account` (
  `user_id` integer PRIMARY KEY NOT NULL,
  `verification_status` text DEFAULT 'unverified' NOT NULL,
  `created_at` integer DEFAULT (strftime('%s', 'now')),
  `updated_at` integer DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `radar_pool` ADD `owner_user_id` integer REFERENCES `user`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `radar_pool` ADD `claimable` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `radar_pool`
SET
  `owner_user_id` = (
    SELECT uw.`user_id`
    FROM `users_to_workspaces` uw
    WHERE uw.`workspace_id` = `radar_pool`.`workspace_id`
    ORDER BY CASE uw.`role` WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
    LIMIT 1
  ),
  `claimable` = 1
WHERE `owner_user_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `radar_pool_owner_user_id_idx` ON `radar_pool` (`owner_user_id`);