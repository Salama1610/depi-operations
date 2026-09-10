CREATE TABLE `account_credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`assignment_id` text,
	`gig_id` text,
	`delta` real NOT NULL,
	`balance_after` real NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `account_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_account_credit_ledger_account_date` ON `account_credit_ledger` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_reservations` (
	`account_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`request_id` text NOT NULL,
	`reserved_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `account_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reserved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_reservations_id_unique` ON `account_reservations` (`id`);--> statement-breakpoint
CREATE TABLE `admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`student_id` text NOT NULL,
	`group_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`admitted_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admissions_application_id_unique` ON `admissions` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `admissions_student_id_unique` ON `admissions` (`student_id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`external_ref` text,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`preferred_track` text NOT NULL,
	`status` text DEFAULT 'Submitted' NOT NULL,
	`source` text NOT NULL,
	`consent_ref` text,
	`owner` text NOT NULL,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_external_ref_unique` ON `applications` (`external_ref`);--> statement-breakpoint
CREATE INDEX `idx_applications_status_owner` ON `applications` (`status`,`owner`);--> statement-breakpoint
CREATE INDEX `idx_applications_track_status` ON `applications` (`preferred_track`,`status`);--> statement-breakpoint
CREATE TABLE `assessment_results` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`score` real NOT NULL,
	`outcome` text NOT NULL,
	`evidence_id` text,
	`notes` text NOT NULL,
	`assessed_by` text NOT NULL,
	`assessed_at` text NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_student_once` ON `assessment_results` (`assessment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `idx_assessment_results_student` ON `assessment_results` (`student_id`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`max_score` real NOT NULL,
	`pass_score` real NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_assessments_group_due` ON `assessments` (`group_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`external_ref` text,
	`issued_by` text NOT NULL,
	`issued_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_external_ref_unique` ON `certificates` (`external_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificate_student_type` ON `certificates` (`student_id`,`type`);--> statement-breakpoint
CREATE TABLE `evidence_package_items` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`item_type` text NOT NULL,
	`attachment_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `evidence_packages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_package_item_type` ON `evidence_package_items` (`package_id`,`item_type`);--> statement-breakpoint
CREATE TABLE `evidence_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_package_revision` ON `evidence_packages` (`evidence_id`,`revision`);--> statement-breakpoint
CREATE TABLE `group_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_closure_action_once` ON `group_closures` (`group_id`,`action`);--> statement-breakpoint
CREATE TABLE `group_coaches` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`coach_type` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`onboarding_status` text DEFAULT 'Pending' NOT NULL,
	`checklist` text DEFAULT '[]' NOT NULL,
	`assigned_by` text NOT NULL,
	`assigned_at` text NOT NULL,
	`onboarded_at` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_coach_role_once` ON `group_coaches` (`group_id`,`user_id`,`coach_type`);--> statement-breakpoint
CREATE INDEX `idx_group_coaches_group_status` ON `group_coaches` (`group_id`,`status`);--> statement-breakpoint
CREATE TABLE `post_program_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`type` text NOT NULL,
	`organization` text,
	`title` text NOT NULL,
	`value` real,
	`currency` text,
	`status` text NOT NULL,
	`proof_id` text,
	`follow_up_at` text NOT NULL,
	`owner` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_outcomes_student_followup` ON `post_program_outcomes` (`student_id`,`follow_up_at`);--> statement-breakpoint
CREATE TABLE `report_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`columns` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_definitions_name_unique` ON `report_definitions` (`name`);--> statement-breakpoint
CREATE TABLE `report_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`definition_id` text NOT NULL,
	`actor` text NOT NULL,
	`filters` text NOT NULL,
	`count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`definition_id`) REFERENCES `report_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `screenings` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`decision` text NOT NULL,
	`criteria` text NOT NULL,
	`reason` text NOT NULL,
	`reviewer` text NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_screenings_application_date` ON `screenings` (`application_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `session_reports` (
	`session_id` text PRIMARY KEY NOT NULL,
	`facilitator` text NOT NULL,
	`notes` text NOT NULL,
	`attendance_reconciled` integer NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facilitator`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text,
	`capacity` integer,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_name_unique` ON `tracks` (`name`);--> statement-breakpoint
CREATE TABLE `withdrawal_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`ministry_reference` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`decided_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `withdrawal_decisions_student_id_unique` ON `withdrawal_decisions` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `withdrawal_decisions_ministry_reference_unique` ON `withdrawal_decisions` (`ministry_reference`);