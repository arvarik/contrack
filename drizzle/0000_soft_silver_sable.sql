CREATE TABLE `action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`interactionId` text,
	`title` text NOT NULL,
	`dueAt` text NOT NULL,
	`completedAt` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interactionId`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `contact_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`address` text NOT NULL,
	`label` text DEFAULT 'home',
	`isPrimary` integer DEFAULT 0,
	`sortOrder` integer DEFAULT 0,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_addresses_contactId_address_unique` ON `contact_addresses` (`contactId`,`address`);--> statement-breakpoint
CREATE TABLE `contact_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_attributes_contactId_name_unique` ON `contact_attributes` (`contactId`,`name`);--> statement-breakpoint
CREATE TABLE `contact_education` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`school` text NOT NULL,
	`degree` text,
	`fieldOfStudy` text,
	`startDate` text,
	`endDate` text,
	`description` text,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`email` text NOT NULL,
	`label` text DEFAULT 'personal',
	`isPrimary` integer DEFAULT 0,
	`sortOrder` integer DEFAULT 0,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_experience` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`company` text NOT NULL,
	`role` text,
	`startDate` text,
	`endDate` text,
	`isCurrent` integer DEFAULT 0,
	`description` text,
	`location` text,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_interests` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`interest` text NOT NULL,
	`isAiGenerated` integer DEFAULT false,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_interests_contactId_interest_unique` ON `contact_interests` (`contactId`,`interest`);--> statement-breakpoint
CREATE TABLE `contact_phones` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`phone` text NOT NULL,
	`label` text DEFAULT 'mobile',
	`isPrimary` integer DEFAULT 0,
	`sortOrder` integer DEFAULT 0,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`handle` text,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`platform` text NOT NULL,
	`externalId` text,
	`connectedOn` text,
	`importedAt` text DEFAULT (CURRENT_TIMESTAMP),
	`rawData` text,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`tag` text NOT NULL,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`firstName` text,
	`lastName` text,
	`headline` text,
	`role` text,
	`company` text,
	`location` text,
	`birthday` text,
	`preferences` text,
	`avatarUrl` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP),
	`cadenceDays` integer DEFAULT 90,
	`lastContactedAt` text,
	`nextFollowUpAt` text,
	`themeColor` text DEFAULT 'brand',
	`about` text,
	`pronouns` text,
	`industry` text,
	`website` text,
	`lat` real,
	`lng` real,
	`aiBriefing` text,
	`aiBackground` text,
	`aiSummary` text,
	`aiHydratedAt` text,
	`aiBriefingAt` text,
	`isGhost` integer DEFAULT 0,
	`isArchived` integer DEFAULT 0,
	`relationshipScore` integer DEFAULT 50
);
--> statement-breakpoint
CREATE TABLE `interaction_mentions` (
	`interactionId` text NOT NULL,
	`contactId` text NOT NULL,
	PRIMARY KEY(`interactionId`, `contactId`),
	FOREIGN KEY (`interactionId`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`date` text DEFAULT (CURRENT_TIMESTAMP),
	`duration` text,
	`fileUrl` text,
	`fileName` text,
	`fileType` text,
	`source` text,
	`mentions` text,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `list_members` (
	`listId` text NOT NULL,
	`contactId` text NOT NULL,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	PRIMARY KEY(`listId`, `contactId`),
	FOREIGN KEY (`listId`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'star' NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP)
);
