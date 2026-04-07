CREATE TABLE `action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`title` text NOT NULL,
	`dueAt` text NOT NULL,
	`completedAt` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `relationshipScore` integer DEFAULT 50;