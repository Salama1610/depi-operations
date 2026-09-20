CREATE TABLE `account_secrets` (
	`account_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`secret` text NOT NULL,
	`iv` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `groups` ADD `account_manager` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `service_links` ADD `account_id` text REFERENCES accounts(id);