CREATE TABLE `editions` (
	`date` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`collection` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `intel_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`delivery_time` text NOT NULL,
	`email_enabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
