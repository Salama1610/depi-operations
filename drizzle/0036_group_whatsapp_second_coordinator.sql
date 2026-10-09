ALTER TABLE `groups` ADD `whatsapp_link` text;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `coordinator_2_id` text REFERENCES users(id);
