ALTER TABLE `users` ADD `national_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `phone` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_national_identity` ON `users` (`national_id`);
