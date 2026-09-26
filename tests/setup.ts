import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A unit test that unmocks server/db.ts gets the real module, which opens
// DATA_DIR/curator.db, or ./curator.db when DATA_DIR is unset. Run from a
// checkout, that is the developer's own database. authLinks, tagRename and
// connectors.ingest wrote test accounts, contacts and links into it on every
// `npm test`. Each unit test file gets a temp directory of its own instead.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-unit-"));

// Mock DB to prevent accidental disk writes during unit tests
vi.mock("../server/db.ts", () => ({
  sqlite: {
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    exec: vi.fn(),
    transaction: vi.fn((cb) => cb),
  },
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  // The real constant, copied rather than stubbed. A module that reads it at
  // import time (backupService does, to decide which tables a snapshot is
  // counted against) fails to load at all without it, and a wrong list here
  // would make a unit test disagree with the database for no visible reason.
  OWNED_TABLES: [
    "contacts",
    "lists",
    "interactions",
    "action_items",
    "dedupe_suggestions",
    "dedupe_exclusions",
    "dedupe_merge_log",
    "ai_invocations",
    "imports",
    "search_history",
    "connectors",
    "connector_runs",
    "connector_links",
    "upcoming_events",
    "oauth_states",
  ],
}));
