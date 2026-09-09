CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`credits` real NOT NULL,
	`secret_ref` text,
	`active_assignment` text
);
--> statement-breakpoint
CREATE TABLE `account_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`student_id` text NOT NULL,
	`group_id` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `account_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_assignments_request_id_unique` ON `account_assignments` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_group_once` ON `account_assignments` (`account_id`,`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_account_once` ON `account_assignments` (`student_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL,
	`recorder` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_key_unique` ON `attachments` (`key`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`recorder` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_attendance` ON `attendance` (`session_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`previous` text,
	`value` text NOT NULL,
	`reason` text,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_request_id_unique` ON `audit_events` (`request_id`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`owner` text NOT NULL,
	`due` text NOT NULL,
	`resolution` text,
	`root_cause` text,
	`prevention` text,
	`verifier` text,
	`source` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cases_source_unique` ON `cases` (`source`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`channel` text NOT NULL,
	`outcome` text NOT NULL,
	`occurred_at` text NOT NULL,
	`proof_id` text NOT NULL,
	`next_action` text NOT NULL,
	`owner` text NOT NULL,
	`due` text NOT NULL,
	`notes` text,
	`recorder` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_student_date` ON `contacts` (`student_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`gig_id` text NOT NULL,
	`proof_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`rejections` integer DEFAULT 0 NOT NULL,
	`code` text,
	`requirements` text,
	`recorder` text NOT NULL,
	`stage_at` text NOT NULL,
	`created_at` text NOT NULL,
	`policy_id` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_gig_id_unique` ON `evidence` (`gig_id`);--> statement-breakpoint
CREATE TABLE `gig_events` (
	`id` text PRIMARY KEY NOT NULL,
	`gig_id` text NOT NULL,
	`status` text NOT NULL,
	`proof_id` text NOT NULL,
	`performed_by` text NOT NULL,
	`recorder` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gigs` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`account_id` text,
	`platform` text NOT NULL,
	`title` text NOT NULL,
	`value` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`order_ref` text,
	`status` text NOT NULL,
	`due` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_platform_order` ON `gigs` (`platform`,`order_ref`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`track` text NOT NULL,
	`provider` text NOT NULL,
	`coordinator` text NOT NULL,
	`supervisor` text NOT NULL,
	`coach` text NOT NULL,
	`pathway` text NOT NULL,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`policy_id` text NOT NULL,
	FOREIGN KEY (`coordinator`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supervisor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coach`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`module` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graduation_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`result` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`calculated_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`config` text NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`task` text NOT NULL,
	`platform` text NOT NULL,
	`value` real NOT NULL,
	`status` text NOT NULL,
	`task_fit` integer DEFAULT 0 NOT NULL,
	`recorder` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`actor` text NOT NULL,
	`decision` text NOT NULL,
	`code` text,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`status` text NOT NULL,
	`week` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_id` text NOT NULL,
	`email` text,
	`phone` text,
	`lifecycle` text DEFAULT 'Active' NOT NULL,
	`engagement` text DEFAULT 'Active' NOT NULL,
	`coaching` text DEFAULT 'In Progress' NOT NULL,
	`milestone` integer DEFAULT 0 NOT NULL,
	`last_contact` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_students_group` ON `students` (`group_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text,
	`title` text NOT NULL,
	`owner` text NOT NULL,
	`due` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`source` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_unique` ON `tasks` (`source`);--> statement-breakpoint
CREATE INDEX `idx_tasks_owner_status_due` ON `tasks` (`owner`,`status`,`due`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`roles` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- Database triggers are intentionally omitted from the hosted baseline. The Sites
-- migration runner splits trigger bodies at their internal semicolons and submits
-- incomplete SQL. Equivalent validation, state-transition, immutability, and
-- concurrency rules are enforced by the server operation layer and covered by the
-- integration suite. The unpublished trigger definitions remain available in Git
-- history for deployments whose migration runner supports complete trigger bodies.
