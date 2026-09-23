CREATE TABLE `import_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`name` text NOT NULL,
	`key_field` text NOT NULL,
	`mapping` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL REFERENCES users(id),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_mapping_source` ON `import_mappings` (`module`,`name`);--> statement-breakpoint
CREATE INDEX `import_mappings_module_idx` ON `import_mappings` (`module`,`name`);
