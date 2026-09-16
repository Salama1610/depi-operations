CREATE UNIQUE INDEX `student_email_identity` ON `students` (lower("email")) WHERE "students"."email" IS NOT NULL AND trim("students"."email") <> '';--> statement-breakpoint
PRAGMA optimize;
