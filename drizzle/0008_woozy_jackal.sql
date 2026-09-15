ALTER TABLE `groups` ADD `delivery_model` text DEFAULT 'Regular' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `coach_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `sessions` ADD `session_day` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `duration_minutes` integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `confirmed_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_session_per_group_week` ON `sessions` (`group_id`,`week`) WHERE "sessions"."status" <> 'Cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_coach_session_per_day` ON `sessions` (`coach_id`,`session_day`) WHERE "sessions"."coach_id" IS NOT NULL AND "sessions"."status" <> 'Cancelled';--> statement-breakpoint
CREATE INDEX `idx_sessions_start` ON `sessions` (`starts_at`);