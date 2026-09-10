CREATE INDEX `idx_graduation_ledger_student_date` ON `graduation_ledger` (`student_id`,`calculated_at`);
--> statement-breakpoint
PRAGMA optimize;
