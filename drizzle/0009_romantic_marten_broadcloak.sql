CREATE TABLE `service_link_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`service_link_id` text NOT NULL,
	`revision` integer NOT NULL,
	`decision` text NOT NULL,
	`comment` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`service_link_id`) REFERENCES `service_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_service_link_reviews_link_date` ON `service_link_reviews` (`service_link_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `service_links` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`slot` integer NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`platform` text NOT NULL,
	`auto_status` text DEFAULT 'Needs Review' NOT NULL,
	`auto_result` text DEFAULT '{}' NOT NULL,
	`auto_checked_at` text,
	`qc_status` text DEFAULT 'Pending' NOT NULL,
	`qc_comment` text,
	`qc_actor` text,
	`qc_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`qc_actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_link_student_slot` ON `service_links` (`student_id`,`slot`);--> statement-breakpoint
CREATE INDEX `idx_service_links_qc_status` ON `service_links` (`qc_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_service_links_student` ON `service_links` (`student_id`);--> statement-breakpoint
CREATE TABLE `service_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`status` text DEFAULT 'Pending QC' NOT NULL,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`qc_completed_at` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_submissions_student_id_unique` ON `service_submissions` (`student_id`);--> statement-breakpoint
CREATE INDEX `idx_service_submissions_status` ON `service_submissions` (`status`);