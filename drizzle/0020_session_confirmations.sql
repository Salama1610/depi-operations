ALTER TABLE `sessions` ADD `coordinator_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `coach_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `group_id` text REFERENCES groups(id);
