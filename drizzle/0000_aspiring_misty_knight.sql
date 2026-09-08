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
CREATE TRIGGER account_assignment_guard BEFORE INSERT ON account_assignments BEGIN
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM accounts a JOIN account_requests r ON r.id=NEW.request_id JOIN students s ON s.id=NEW.student_id WHERE a.id=NEW.account_id AND a.status='Available' AND a.active_assignment IS NULL AND a.credits>=r.value AND a.platform=r.platform AND r.status='Submitted' AND r.student_id=NEW.student_id AND s.group_id=NEW.group_id) THEN RAISE(ABORT,'Account assignment eligibility changed; refresh and retry.') END;
END;
--> statement-breakpoint
CREATE TRIGGER account_nonnegative_insert BEFORE INSERT ON accounts WHEN NEW.credits<0 BEGIN SELECT RAISE(ABORT,'Account credits cannot be negative.'); END;
--> statement-breakpoint
CREATE TRIGGER account_nonnegative_update BEFORE UPDATE ON accounts WHEN NEW.credits<0 BEGIN SELECT RAISE(ABORT,'Account credits cannot be negative.'); END;
--> statement-breakpoint
CREATE TRIGGER account_retired_terminal BEFORE UPDATE OF status ON accounts WHEN OLD.status='Retired' AND NEW.status<>'Retired' BEGIN SELECT RAISE(ABORT,'Retired accounts cannot be reopened.'); END;
--> statement-breakpoint
CREATE TRIGGER contact_complete BEFORE INSERT ON contacts BEGIN
SELECT CASE WHEN trim(NEW.next_action)='' OR trim(NEW.outcome)='' OR trim(NEW.due)='' OR NOT EXISTS(SELECT 1 FROM attachments a WHERE a.id=NEW.proof_id AND a.student_id=NEW.student_id) THEN RAISE(ABORT,'Complete contact requires matching proof, outcome, next action and due date.') END;
END;
--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit history is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit history is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON evidence_reviews BEGIN SELECT RAISE(ABORT,'Review history is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON evidence_reviews BEGIN SELECT RAISE(ABORT,'Review history is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER gig_valid_transition BEFORE UPDATE OF status ON gigs WHEN NEW.status<>OLD.status BEGIN
SELECT CASE WHEN NOT ((OLD.status='Account Assigned' AND NEW.status='Gig Opened') OR (OLD.status='Gig Opened' AND NEW.status='Work Submitted') OR (OLD.status='Work Submitted' AND NEW.status='Delivered') OR (OLD.status='Delivered' AND NEW.status='Paid') OR (OLD.status NOT IN ('Paid','Cancelled','Failed') AND NEW.status IN ('Cancelled','Failed'))) THEN RAISE(ABORT,'Invalid gig workflow transition.') END;
END;
--> statement-breakpoint
CREATE TRIGGER evidence_paid_intake BEFORE INSERT ON evidence BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gigs g JOIN attachments a ON a.id=NEW.proof_id WHERE g.id=NEW.gig_id AND g.student_id=NEW.student_id AND a.student_id=NEW.student_id AND g.status='Paid') THEN RAISE(ABORT,'Evidence requires a paid gig and matching proof.') END; END;
--> statement-breakpoint
CREATE TRIGGER gig_no_delete BEFORE DELETE ON gigs BEGIN SELECT RAISE(ABORT,'Gigs must remain in history.'); END;
--> statement-breakpoint
CREATE TRIGGER effective_policy_immutable BEFORE UPDATE OF config ON policies WHEN OLD.status IN ('Approved','Effective','Superseded') BEGIN SELECT RAISE(ABORT,'Approved policy contents are immutable; create a new version.'); END;
--> statement-breakpoint
CREATE TRIGGER evidence_valid_transition BEFORE UPDATE OF status ON evidence WHEN NEW.status<>OLD.status BEGIN
SELECT CASE WHEN NOT ((OLD.status='Coach Review' AND NEW.status='Coordinator L1') OR (OLD.status='Coordinator L1' AND NEW.status='Quality Review') OR (OLD.status='Quality Review' AND NEW.status IN ('Accepted','Rejected','L3 Review')) OR (OLD.status='Rejected' AND NEW.status IN ('Quality Review','L3 Review')) OR (OLD.status='L3 Review' AND NEW.status IN ('Accepted','Rejected','Closed L3')) OR (OLD.status='Accepted' AND NEW.status='L3 Review')) THEN RAISE(ABORT,'Evidence state changed or transition is invalid; refresh the review.') END;
END;
