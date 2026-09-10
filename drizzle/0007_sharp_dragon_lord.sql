ALTER TABLE `report_definitions` ADD `approved_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `report_definitions` ADD `approved_at` text;