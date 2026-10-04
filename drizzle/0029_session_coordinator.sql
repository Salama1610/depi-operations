ALTER TABLE `sessions` ADD `coordinator_id` text REFERENCES users(id);--> statement-breakpoint
UPDATE `sessions` SET `coordinator_id` = (SELECT `coordinator` FROM `groups` WHERE `groups`.`id` = `sessions`.`group_id`) WHERE `coordinator_id` IS NULL;--> statement-breakpoint
CREATE INDEX `sessions_coordinator_idx` ON `sessions` (`coordinator_id`);
