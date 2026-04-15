CREATE TABLE IF NOT EXISTS `ai_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`model` text,
	`tokenCount` integer,
	`latencyMs` integer NOT NULL,
	`cached` integer DEFAULT 0 NOT NULL,
	`description` text,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_invocations_created` ON `ai_invocations` (`createdAt` DESC);