ALTER TABLE `accounts` ADD `owner_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `coordinator_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `pending_credits` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `comments` text;--> statement-breakpoint
CREATE INDEX `idx_accounts_coordinator` ON `accounts` (`coordinator_id`);
