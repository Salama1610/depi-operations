CREATE TABLE `join_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`group_id` text REFERENCES groups(id),
	`username` text NOT NULL,
	`secret` text NOT NULL,
	`iv` text NOT NULL,
	`updated_by` text NOT NULL REFERENCES users(id),
	`updated_at` text NOT NULL
);
