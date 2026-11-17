ALTER TABLE `sessions` ADD `merge_key` text;--> statement-breakpoint
DROP INDEX IF EXISTS `one_active_coach_session_per_day`;--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_coach_session_per_day` ON `sessions` (`coach_id`,`session_day`) WHERE `coach_id` IS NOT NULL AND `status` <> 'Cancelled' AND `merge_key` IS NULL;
