CREATE TABLE `feedback_flags` (
	`session_id` text PRIMARY KEY NOT NULL REFERENCES sessions(id),
	`score` real NOT NULL,
	`note` text NOT NULL,
	`case_id` text REFERENCES cases(id),
	`handled_by` text NOT NULL REFERENCES users(id),
	`handled_at` text NOT NULL
);
