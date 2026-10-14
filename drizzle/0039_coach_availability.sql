CREATE TABLE `coach_availability` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES users(id),
	`slots` text DEFAULT '[]' NOT NULL,
	`note` text,
	`updated_by` text REFERENCES users(id),
	`updated_at` text NOT NULL
);
