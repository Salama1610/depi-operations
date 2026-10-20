CREATE TABLE `quality_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL REFERENCES groups(id),
	`audience` text NOT NULL,
	`description` text NOT NULL,
	`created_by` text NOT NULL REFERENCES users(id),
	`created_at` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`handled_by` text REFERENCES users(id),
	`handled_at` text,
	`handled_note` text
);
--> statement-breakpoint
CREATE INDEX `quality_reports_status_idx` ON `quality_reports` (`status`,`created_at`);
