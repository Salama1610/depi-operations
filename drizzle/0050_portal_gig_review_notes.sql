CREATE TABLE `portal_gig_review_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`proof_key` text NOT NULL,
	`portal_gig_id` text,
	`kind` text NOT NULL,
	`status` text,
	`comment` text,
	`author` text REFERENCES users(id),
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_gig_review_notes_key_idx` ON `portal_gig_review_notes` (`proof_key`,`created_at`);
