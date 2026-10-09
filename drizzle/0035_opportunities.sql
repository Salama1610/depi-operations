CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`track` text NOT NULL,
	`platform` text NOT NULL,
	`posted_on` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_by` text NOT NULL REFERENCES users(id),
	`created_at` text NOT NULL,
	`removed_by` text REFERENCES users(id),
	`removed_at` text
);
--> statement-breakpoint
CREATE INDEX `opportunities_track_idx` ON `opportunities` (`track`,`status`,`posted_on`);
