ALTER TABLE `portal_gig_reviews` ADD `proof_key` text;--> statement-breakpoint
UPDATE `portal_gig_reviews` SET `proof_key` = 'gig:' || `portal_gig_id` WHERE `proof_key` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `portal_gig_reviews_proof_key` ON `portal_gig_reviews` (`proof_key`);
