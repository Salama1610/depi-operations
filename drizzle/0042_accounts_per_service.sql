DROP INDEX IF EXISTS `accounts_one_per_student`;--> statement-breakpoint
ALTER TABLE `accounts` ADD `service_link_id` text REFERENCES service_links(id);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_one_per_service` ON `accounts` (`service_link_id`) WHERE `service_link_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `accounts_student_idx` ON `accounts` (`student_id`) WHERE `student_id` IS NOT NULL;
