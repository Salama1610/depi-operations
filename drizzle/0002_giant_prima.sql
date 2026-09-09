CREATE TABLE `attachment_context` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`gig_id` text,
	`account_id` text,
	`activity_type` text NOT NULL,
	`platform` text,
	`occurred_at` text NOT NULL,
	`source` text NOT NULL,
	`performed_by_type` text NOT NULL,
	`performed_by_student_id` text,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attachment_context_gig_activity` ON `attachment_context` (`gig_id`,`activity_type`);--> statement-breakpoint
CREATE TABLE `case_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_case_events_case_date` ON `case_events` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`module` text NOT NULL,
	`format` text NOT NULL,
	`filters` text NOT NULL,
	`count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `group_gate_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`week` integer NOT NULL,
	`check_key` text NOT NULL,
	`status` text NOT NULL,
	`evidence_id` text,
	`owner` text NOT NULL,
	`due` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_gate_check_once` ON `group_gate_checks` (`group_id`,`week`,`check_key`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`status` text NOT NULL,
	`errors` text,
	`record_id` text,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_once` ON `import_rows` (`import_id`,`row_number`);--> statement-breakpoint
CREATE TABLE `account_request_details` (
	`request_id` text PRIMARY KEY NOT NULL,
	`task_bank_id` text NOT NULL,
	`job_profile` text NOT NULL,
	`gig_number` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`request_id`) REFERENCES `account_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_bank_id`) REFERENCES `task_bank`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `retention_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`cutoff` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`approved_by` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module` text NOT NULL,
	`name` text NOT NULL,
	`filters` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_view_user_module_name` ON `saved_views` (`user_id`,`module`,`name`);--> statement-breakpoint
CREATE TABLE `student_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`dimension` text NOT NULL,
	`previous` text NOT NULL,
	`value` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_status_events_student_date` ON `student_status_events` (`student_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `system_configuration` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`classification` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`track` text NOT NULL,
	`title` text NOT NULL,
	`platform` text NOT NULL,
	`value` real NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_bank_track_title` ON `task_bank` (`track`,`title`);