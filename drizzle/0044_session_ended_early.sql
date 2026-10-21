ALTER TABLE `sessions` ADD `ended_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ended_by` text REFERENCES users(id);
