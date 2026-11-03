CREATE TABLE `portal_coaches` (
	`group_id` text PRIMARY KEY NOT NULL REFERENCES groups(id),
	`coach_name` text,
	`coach_email` text,
	`coach_user_id` text REFERENCES users(id),
	`uploaded_by` text NOT NULL REFERENCES users(id),
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_coaches_user_idx` ON `portal_coaches` (`coach_user_id`);
