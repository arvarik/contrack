-- Existing v2 tables use guarded migrations in server/db.ts.
-- This migration adds only the new search evidence tables.
CREATE TABLE `search_passage_state` (
	`contactId` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`representationVersion` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`signature` text NOT NULL,
	`indexedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_search_passage_state_owner` ON `search_passage_state` (`ownerId`);
--> statement-breakpoint
CREATE TABLE `search_passages` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`ownerId` text NOT NULL,
	`field` text NOT NULL,
	`sourceId` text NOT NULL,
	`sourceHash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`context` text NOT NULL,
	`startOffset` integer NOT NULL,
	`endOffset` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_search_passages_contact` ON `search_passages` (`contactId`);
--> statement-breakpoint
CREATE INDEX `idx_search_passages_owner` ON `search_passages` (`ownerId`);
