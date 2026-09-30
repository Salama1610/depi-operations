PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_request_details` (
	`request_id` text PRIMARY KEY NOT NULL,
	`task_bank_id` text,
	`job_profile` text NOT NULL,
	`gig_number` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`request_id`) REFERENCES `account_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_bank_id`) REFERENCES `task_bank`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_account_request_details` SELECT `request_id`,`task_bank_id`,`job_profile`,`gig_number`,`notes` FROM `account_request_details`;--> statement-breakpoint
DROP TABLE `account_request_details`;--> statement-breakpoint
ALTER TABLE `__new_account_request_details` RENAME TO `account_request_details`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
