CREATE TABLE `account_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL REFERENCES accounts(id),
	`student_id` text NOT NULL REFERENCES students(id),
	`service_link_id` text REFERENCES service_links(id),
	`coordinator` text NOT NULL REFERENCES users(id),
	`order_ref` text,
	`amount` real,
	`note` text,
	`status` text DEFAULT 'In Progress' NOT NULL,
	`proof_id` text REFERENCES attachments(id),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`done_at` text,
	`proof_at` text,
	`cancelled_at` text
);
--> statement-breakpoint
CREATE INDEX `account_orders_account_idx` ON `account_orders` (`account_id`);--> statement-breakpoint
CREATE INDEX `account_orders_student_idx` ON `account_orders` (`student_id`);--> statement-breakpoint
CREATE INDEX `account_orders_status_idx` ON `account_orders` (`status`,`updated_at`);
