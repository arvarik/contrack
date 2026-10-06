// =============================================================================
// Migration 0006_dedupe_caveat
// =============================================================================
// A duplicate pair's caution gets a column of its own. The policy used to
// append it to the reason, as in "Shared phone number. the first names differ
// ("ada" ↔ "ben"), so review this pair", so the review screen could show it
// only inside the reason, behind a click. With the caution apart, the screen
// shows it on the row, and the reason stays a plain statement of the match.
//
// Pairs stored before this keep their combined reason and no caution. A scan
// replaces every pending pair, so the next one writes both columns.
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE dedupe_suggestions ADD COLUMN caveat TEXT;
  `);
}
