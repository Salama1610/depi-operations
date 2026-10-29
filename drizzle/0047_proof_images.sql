CREATE TABLE `proof_images` (
	`proof_url` text PRIMARY KEY NOT NULL,
	`sha256` text,
	`dhash` text,
	`bytes` integer,
	`error` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proof_images_sha256_idx` ON `proof_images` (`sha256`);
