CREATE TABLE `portal_gig_reviews` (
	`portal_gig_id` text PRIMARY KEY NOT NULL,
	`portal_student_id` text NOT NULL,
	`student_id` text REFERENCES students(id),
	`student_name` text,
	`title` text,
	`url` text,
	`reviewer` text NOT NULL REFERENCES users(id),
	`assigned_by` text REFERENCES users(id),
	`assigned_at` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`comment` text,
	`reviewed_by` text REFERENCES users(id),
	`reviewed_at` text
);
--> statement-breakpoint
CREATE INDEX `portal_gig_reviews_reviewer_idx` ON `portal_gig_reviews` (`reviewer`,`status`);
--> statement-breakpoint
CREATE INDEX `portal_gig_reviews_student_idx` ON `portal_gig_reviews` (`portal_student_id`);
