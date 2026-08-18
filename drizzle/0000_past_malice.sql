CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`language` text DEFAULT 'en',
	`ui_preferences` text,
	`custom_benchmarks` text DEFAULT '[]',
	`custom_timeframes` text DEFAULT '[]',
	`onboarding_status` text DEFAULT '{"completed":false}',
	`onboarding_draft` text DEFAULT '{"draft":null}',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
