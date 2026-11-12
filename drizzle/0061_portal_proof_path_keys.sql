ALTER TABLE `portal_gigs` ADD `proof_key` text;--> statement-breakpoint
CREATE INDEX `portal_gigs_batch_proof_idx` ON `portal_gigs` (`batch_id`,`proof_key`);
