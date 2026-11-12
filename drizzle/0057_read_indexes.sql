CREATE INDEX IF NOT EXISTS `idx_evidence_student` ON `evidence` (`student_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gigs_student` ON `gigs` (`student_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gigs_account` ON `gigs` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_attendance_student` ON `attendance` (`student_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_events_actor_date` ON `audit_events` (`actor`,`created_at`);
