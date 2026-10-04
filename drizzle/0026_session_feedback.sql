CREATE TABLE `session_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES sessions(id),
	`student_id` text NOT NULL REFERENCES students(id),
	`satisfaction` integer NOT NULL,
	`clarity` integer NOT NULL,
	`searched_gig` integer NOT NULL,
	`usefulness` integer NOT NULL,
	`liked` text,
	`comments` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_feedback_student` ON `session_feedback` (`session_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `session_feedback_session_idx` ON `session_feedback` (`session_id`);
