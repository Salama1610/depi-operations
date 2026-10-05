ALTER TABLE `users` ADD `team` text;--> statement-breakpoint
UPDATE `users` SET `team` = 'Service Team' WHERE `team` IS NULL AND lower(`title`) LIKE '%service team%';--> statement-breakpoint
UPDATE `users` SET `team` = 'Target Team' WHERE `team` IS NULL AND lower(`title`) LIKE '%target team%';--> statement-breakpoint
UPDATE `attendance` SET `status` = 'Present' WHERE `status` = 'Late';--> statement-breakpoint
UPDATE `attendance` SET `status` = 'Absent' WHERE `status` = 'Excused';
