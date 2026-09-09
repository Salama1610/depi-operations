CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text NOT NULL,
	`usd_rate` real NOT NULL,
	`effective_date` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rate_currency_date` ON `fx_rates` (`currency`,`effective_date`);--> statement-breakpoint
CREATE TABLE `gig_fx_applications` (
	`gig_id` text PRIMARY KEY NOT NULL,
	`fx_rate_id` text NOT NULL,
	`usd_value` real NOT NULL,
	`applied_by` text NOT NULL,
	`applied_at` text NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fx_rate_id`) REFERENCES `fx_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
