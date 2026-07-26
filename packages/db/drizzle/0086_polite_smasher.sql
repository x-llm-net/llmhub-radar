ALTER TABLE `radar_verification_application` ALTER COLUMN "contact_qq" TO "contact_qq" text(64);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ALTER COLUMN "website_url" TO "website_url" text(256);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ALTER COLUMN "proof" TO "proof" text(2000);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `legal_representative_name` text(120);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `identity_number_encrypted` text;
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `identity_number_hash` text(128);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `identity_number_masked` text(32);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `mobile_encrypted` text;
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `mobile_hash` text(128);
--> statement-breakpoint
ALTER TABLE `radar_verification_application` ADD `mobile_masked` text(32);
--> statement-breakpoint
CREATE INDEX `radar_verification_application_identity_hash_idx` ON `radar_verification_application` (`identity_number_hash`);
--> statement-breakpoint
CREATE INDEX `radar_verification_application_credit_code_idx` ON `radar_verification_application` (`credit_code`);
