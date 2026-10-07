CREATE TABLE `support_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter` text NOT NULL REFERENCES users(id),
	`reporter_roles` text NOT NULL,
	`page` text NOT NULL,
	`url` text,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`action` text NOT NULL,
	`happened` text NOT NULL,
	`expected` text,
	`occurred_at` text NOT NULL,
	`browser` text,
	`screenshot_key` text,
	`screenshot_type` text,
	`status` text DEFAULT 'Open' NOT NULL,
	`resolution` text,
	`handled_by` text REFERENCES users(id),
	`handled_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `support_reports_status_idx` ON `support_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_reports_reporter_idx` ON `support_reports` (`reporter`,`created_at`);
