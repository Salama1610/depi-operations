CREATE TABLE `session_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES sessions(id),
	`item` text NOT NULL,
	`done_by` text NOT NULL REFERENCES users(id),
	`done_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_check_item` ON `session_checks` (`session_id`,`item`);--> statement-breakpoint
CREATE INDEX `session_checks_session_idx` ON `session_checks` (`session_id`);
