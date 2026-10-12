CREATE TABLE `feedback_reviews` (
	`session_id` text PRIMARY KEY NOT NULL REFERENCES sessions(id),
	`reviewer` text NOT NULL REFERENCES users(id),
	`assigned_by` text REFERENCES users(id),
	`assigned_at` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`note` text,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE INDEX `feedback_reviews_reviewer_idx` ON `feedback_reviews` (`reviewer`,`status`);
