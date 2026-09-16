CREATE TABLE `roster_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source_name` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_sha256` text NOT NULL,
	`total_rows` integer NOT NULL,
	`canonical_students` integer NOT NULL,
	`duplicate_rows` integer NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_imports_source_sha256_unique` ON `roster_imports` (`source_sha256`);--> statement-breakpoint
CREATE TABLE `roster_source_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`student_id` text,
	`disposition` text NOT NULL,
	`reason` text,
	`payload` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `roster_imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_source_import_row` ON `roster_source_rows` (`import_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `idx_roster_source_student` ON `roster_source_rows` (`student_id`);--> statement-breakpoint
ALTER TABLE `students` ADD `tp_id` text;--> statement-breakpoint
ALTER TABLE `students` ADD `national_id` text;--> statement-breakpoint
ALTER TABLE `students` ADD `name_ar` text;--> statement-breakpoint
ALTER TABLE `students` ADD `job_profile` text;--> statement-breakpoint
ALTER TABLE `students` ADD `student_type` text;--> statement-breakpoint
ALTER TABLE `students` ADD `source_status` text;--> statement-breakpoint
ALTER TABLE `students` ADD `serial` text;--> statement-breakpoint
ALTER TABLE `students` ADD `round_1` text;--> statement-breakpoint
ALTER TABLE `students` ADD `source_row` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `student_tp_identity` ON `students` (`tp_id`) WHERE "students"."tp_id" IS NOT NULL AND trim("students"."tp_id") <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `student_national_identity` ON `students` (`national_id`) WHERE "students"."national_id" IS NOT NULL AND trim("students"."national_id") <> '';