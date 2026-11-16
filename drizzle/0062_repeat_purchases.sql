DROP INDEX IF EXISTS `accounts_one_per_service`;--> statement-breakpoint
CREATE INDEX `accounts_by_service` ON `accounts` (`service_link_id`) WHERE `service_link_id` IS NOT NULL;
