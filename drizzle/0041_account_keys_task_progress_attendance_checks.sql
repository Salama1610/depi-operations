ALTER TABLE `accounts` ADD `student_id` text REFERENCES students(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `linked_at` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `linked_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `coordinator_state` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `coordinator_note` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `coordinator_state_at` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `coordinator_state_by` text REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_one_per_student` ON `accounts` (`student_id`) WHERE `student_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `task_progress` (
	`task_id` text PRIMARY KEY NOT NULL REFERENCES tasks(id),
	`status` text NOT NULL,
	`note` text,
	`updated_by` text NOT NULL REFERENCES users(id),
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attendance_checks` (
	`session_id` text PRIMARY KEY NOT NULL REFERENCES sessions(id),
	`status` text NOT NULL,
	`note` text,
	`checked_by` text NOT NULL REFERENCES users(id),
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attendance_checks_status_idx` ON `attendance_checks` (`status`);
