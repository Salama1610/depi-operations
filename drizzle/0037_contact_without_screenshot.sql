CREATE TABLE `contacts_new` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`channel` text NOT NULL,
	`outcome` text NOT NULL,
	`occurred_at` text NOT NULL,
	`proof_id` text,
	`next_action` text NOT NULL,
	`owner` text NOT NULL,
	`due` text NOT NULL,
	`notes` text,
	`recorder` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `contacts_new` SELECT `id`,`student_id`,`channel`,`outcome`,`occurred_at`,`proof_id`,`next_action`,`owner`,`due`,`notes`,`recorder`,`created_at` FROM `contacts`;
--> statement-breakpoint
DROP TABLE `contacts`;
--> statement-breakpoint
ALTER TABLE `contacts_new` RENAME TO `contacts`;
--> statement-breakpoint
CREATE INDEX `idx_contacts_student_date` ON `contacts` (`student_id`,`occurred_at`);
