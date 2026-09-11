import { vi } from "vitest";

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
  ],
}));
