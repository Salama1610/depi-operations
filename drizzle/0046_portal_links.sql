CREATE TABLE `portal_links` (
	`portal_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`student_id` text NOT NULL REFERENCES students(id),
	`linked_by` text NOT NULL REFERENCES users(id),
	`linked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_links_email_idx` ON `portal_links` (`email`);
