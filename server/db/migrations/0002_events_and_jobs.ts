// =============================================================================
// Migration 0002_events_and_jobs
// =============================================================================
// Three tables for two pieces of the core, in the shape of plan section 4.
//
// - `events`: a write records what it changed here, in its own transaction
//   (server/events/). A rolled-back write leaves no row, and a crash between
//   the commit and the reaction loses nothing. The table is owned: every row
//   names the account it belongs to, and `events_owner_required` refuses a
//   row without one, in the shape of the baseline's other
//   `<table>_owner_required` triggers.
// - `event_cursors`: how far each subscriber has read, and how often it has
//   failed on the event after that.
// - `jobs`: background work (server/jobs/). `ownerId` is null for the work of
//   the whole instance, such as a backup, so the table is not owned and has
//   no owner trigger. `idx_jobs_dedupe` keeps one queued or running row per
//   key, which is how a recurring job keeps one next run.
//
// Both owner keys use ON DELETE RESTRICT like every owned table, so
// purgeOwner deletes an account's events and jobs before the account.
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,  -- the order subscribers read in
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      subjectType TEXT NOT NULL,             -- 'contact' | 'interaction' | 'action_item' | 'list'
      subjectId TEXT NOT NULL,
      payload TEXT NOT NULL,                 -- JSON, the schema of its type
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX idx_events_owner ON events(ownerId, id);

    CREATE TRIGGER events_owner_required BEFORE INSERT ON events
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'events.ownerId is required'); END;

    CREATE TABLE event_cursors (
      subscriber TEXT PRIMARY KEY,
      lastEventId INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT, -- null for instance jobs
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
      runAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      attempts INTEGER NOT NULL DEFAULT 0,
      maxAttempts INTEGER NOT NULL DEFAULT 3,
      lastError TEXT,
      progress TEXT,                         -- JSON, for the queues that move later
      dedupeKey TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      startedAt TEXT,
      finishedAt TEXT
    );
    CREATE INDEX idx_jobs_due ON jobs(status, runAt);
    CREATE UNIQUE INDEX idx_jobs_dedupe ON jobs(dedupeKey) WHERE status IN ('queued', 'running');
  `);
}
