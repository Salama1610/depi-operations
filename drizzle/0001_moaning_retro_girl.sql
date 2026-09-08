CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`title` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`severity` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`recipient`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_source_unique` ON `notifications` (`source`);--> statement-breakpoint
CREATE INDEX `idx_notifications_recipient_date` ON `notifications` (`recipient`,`created_at`);