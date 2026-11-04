CREATE TABLE `session_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES sessions(id),
	`author` text NOT NULL REFERENCES users(id),
	`comments` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_notes_author` ON `session_notes` (`session_id`,`author`);
