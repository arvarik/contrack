// =============================================================================
// Migration 0008_correspondent_names
// =============================================================================
// A correspondent keeps the name its mail or meeting gave, such as "Rowan
// Vale" in "Rowan Vale <rowan@example.com>". Only the address was kept, so
// "Add as contact" made a contact named by its email address.
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  // tenant-lint: allow boot migration
  db.exec(`ALTER TABLE connector_links ADD COLUMN displayName TEXT;`);
}
