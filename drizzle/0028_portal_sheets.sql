ALTER TABLE `gigs` ADD `paid_by_account` text;--> statement-breakpoint
CREATE TABLE `portal_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet` text NOT NULL,
	`batch_id` text NOT NULL,
	`status` text NOT NULL,
	`file_name` text,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_linked` integer DEFAULT 0 NOT NULL,
	`mapping` text DEFAULT '{}' NOT NULL,
	`uploaded_by` text NOT NULL REFERENCES users(id),
	`created_at` text NOT NULL,
	`committed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_uploads_batch` ON `portal_uploads` (`batch_id`);--> statement-breakpoint
CREATE INDEX `portal_uploads_sheet_idx` ON `portal_uploads` (`sheet`,`status`);--> statement-breakpoint
CREATE TABLE `portal_students` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`student_id` text,
	`portal_id` text,
	`email` text,
	`full_name` text,
	`phone` text,
	`round_code` text,
	`city` text,
	`provider` text,
	`track` text,
	`profile` text,
	`status` text,
	`final_status` text,
	`graduate_type` text,
	`total_gigs` real,
	`approved_gigs` real,
	`rejected_gigs` real,
	`total_revenue` real,
	`proof_links` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_students_batch_idx` ON `portal_students` (`batch_id`,`portal_id`);--> statement-breakpoint
CREATE INDEX `portal_students_student_idx` ON `portal_students` (`student_id`);--> statement-breakpoint
CREATE TABLE `portal_gigs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`portal_gig_id` text,
	`portal_student_id` text,
	`student_email` text,
	`student_name` text,
	`title` text,
	`url` text,
	`category` text,
	`task` text,
	`organization` text,
	`client_name` text,
	`price` real,
	`created_on` text,
	`updated_on` text,
	`status` text,
	`provider_status` text,
	`auditor_status` text,
	`comment` text,
	`action_by` text,
	`proof_url` text
);
--> statement-breakpoint
CREATE INDEX `portal_gigs_batch_idx` ON `portal_gigs` (`batch_id`,`portal_student_id`);
