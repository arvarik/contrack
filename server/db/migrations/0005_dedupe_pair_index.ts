// =============================================================================
// Migration 0005_dedupe_pair_index
// =============================================================================
// An index on dedupe_suggestions.contactIdB. The UNIQUE(contactIdA,
// contactIdB) index already finds a suggestion by its first contact. Nothing
// found one by its second, so every lookup by contact read all of the
// account's suggestions.
//
// The import's duplicate check counts the suggestions that name its contacts
// every 50 rows. With 14,000 suggestions that count took more than a second
// each time, and the server answered nobody while it ran. With this index the
// count starts from the import's rows and looks each one up on both sides.
// The ON DELETE CASCADE of a contact also finds its suggestions this way.
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE INDEX idx_dedupe_sugg_contact_b ON dedupe_suggestions(contactIdB);
  `);
}
