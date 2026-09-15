// =============================================================================
// Interaction search index — interactions_fts and the triggers that feed it
// =============================================================================
// contacts_fts answers "which person". This table answers "which note": a
// title, the readable text of the body, and the owner token, mirrored by
// rowid from `interactions` exactly the way contacts_fts mirrors `contacts`.
//
// Three decisions are worth knowing before touching this file:
//
//   • The body goes in as plain text. The triggers call `contrack_note_text`,
//     a SQL function this module registers on the connection, so an insert
//     from any path — the composer, an email import, a merge undo, a seed
//     script — is indexed as readable text and never as HTML. A connection
//     that has not registered the function cannot insert or update a note.
//     That is the trade: every write path is covered, and this database is
//     written by this app.
//   • The tokenizer stems. `porter unicode61 remove_diacritics 2` makes
//     "hire" match "hiring", "engineer" match "engineers", and "cafe" match
//     "café". Names are not stemmed anywhere in contacts_fts, and should not
//     be; note text is prose, and prose is what a stemmer is for.
//   • Visibility is decided at query time. A note on an archived, trashed,
//     merged or ghost contact stays in the index, and the search joins to
//     `contacts` with ACTIVE_CONTACT_SQL to hide it. Restoring the contact
//     brings its notes back without touching the index.
// =============================================================================

import type Database from "better-sqlite3";
import { notePlainText } from "./noteText.ts";

/** The SQL function the triggers call. Registered by `installInteractionSearchIndex`. */
export const NOTE_TEXT_FUNCTION = "contrack_note_text";

/**
 * Every interactions_fts column, in order. Position 0 is the UNINDEXED id.
 *
 * `ownerTok` is last and indexed, for the same reason as in contacts_fts:
 * the search prefixes every query with `ownerTok:<token> AND (...)` so FTS5
 * intersects posting lists inside the index rather than post-filtering rows
 * the caller may not read.
 */
export const INTERACTION_FTS_COLUMNS =
  "interactionId, title, content, ownerTok";

/**
 * One bm25 weight per column. The id and the owner token carry none. A title
 * match outranks the same word in a body, because a title is what the person
 * chose to call the note.
 */
export const INTERACTION_WEIGHTS = "0, 3, 1, 0";

/** The position of each column, for snippet() and highlight(). */
export const INTERACTION_FTS_TITLE_COLUMN = 1;
export const INTERACTION_FTS_CONTENT_COLUMN = 2;

/**
 * The columns whose change makes an index row wrong.
 *
 * `ownerId` is here so that a row inserted without an owner, which the
 * `interactions_owner_fill` trigger stamps a moment later, is indexed once
 * the owner is known. `contactId`, `date` and `type` are not: the search
 * reads those from `interactions` at query time.
 */
export const INTERACTION_SEARCH_COLUMNS = "title, content, ownerId";

/** Must stay identical to ownerToken() in server/tenancy/scope.ts. */
const OWNER_TOKEN_SQL = (row: string) =>
  `'o' || replace(${row}.ownerId, '-', '')`;

/** The values of one index row, read from an interactions row alias. */
function ftsValues(row: string): string {
  return `${row}.rowid, ${row}.id, ${row}.title, ${NOTE_TEXT_FUNCTION}(${row}.content), ${OWNER_TOKEN_SQL(row)}`;
}

/**
 * The three triggers that keep interactions_fts in step with interactions.
 *
 * Deletes are by `rowid`, which FTS5 pushes down, never by the UNINDEXED id.
 * Inserts are gated on `ownerId IS NOT NULL`: a row that arrives without an
 * owner is filled by `interactions_owner_fill`, whose UPDATE of `ownerId`
 * fires the update trigger below, so the row is indexed exactly once and
 * never with an empty owner token.
 *
 * Exported so a unit test can pin these properties.
 */
export function interactionTriggerSql(): string {
  // Every insert copies the owner token of the interaction row it mirrors,
  // and every delete is by the rowid of that same row.
  // tenant-lint: allow derived table
  return `
      DROP TRIGGER IF EXISTS interactions_fts_ai;
      DROP TRIGGER IF EXISTS interactions_fts_au;
      DROP TRIGGER IF EXISTS interactions_fts_ad;
      CREATE TRIGGER interactions_fts_ai AFTER INSERT ON interactions
      WHEN new.ownerId IS NOT NULL
      BEGIN
        INSERT INTO interactions_fts(rowid, ${INTERACTION_FTS_COLUMNS})
        VALUES (${ftsValues("new")});
      END;
      CREATE TRIGGER interactions_fts_au AFTER UPDATE OF ${INTERACTION_SEARCH_COLUMNS} ON interactions
      BEGIN
        DELETE FROM interactions_fts WHERE rowid = old.rowid;
        INSERT INTO interactions_fts(rowid, ${INTERACTION_FTS_COLUMNS})
        SELECT ${ftsValues("new")} WHERE new.ownerId IS NOT NULL;
      END;
      CREATE TRIGGER interactions_fts_ad AFTER DELETE ON interactions
      BEGIN
        DELETE FROM interactions_fts WHERE rowid = old.rowid;
      END;`;
}

/**
 * Register the plain-text function on a connection.
 *
 * Idempotent: SQLite replaces a function registered under the same name and
 * arity, so calling this on every install is safe. Deterministic, so SQLite
 * may fold it inside one statement.
 */
export function registerNoteTextFunction(sqlite: Database.Database): void {
  sqlite.function(
    NOTE_TEXT_FUNCTION,
    { deterministic: true },
    (value: unknown) => notePlainText(value == null ? null : String(value)),
  );
}

/**
 * Create or rebuild interactions_fts, install its triggers, and index any
 * interaction that has no row yet.
 *
 * Runs inside the transaction `installSearchIndex` opens, and under the same
 * version gate: `rebuilt` is true when `PRAGMA user_version` disagreed with
 * FTS_SCHEMA_VERSION, and then the table is dropped and filled again.
 *
 * @returns how many rows the backfill wrote
 */
export function installInteractionSearchIndex(
  sqlite: Database.Database,
  rebuilt: boolean,
): number {
  registerNoteTextFunction(sqlite);
  if (rebuilt) sqlite.exec("DROP TABLE IF EXISTS interactions_fts");
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS interactions_fts USING fts5(
      interactionId UNINDEXED, title, content, ownerTok,
      tokenize = 'porter unicode61 remove_diacritics 2'
    );
    ${interactionTriggerSql()}
  `);
  // Every row this writes takes its owner token from the interaction it
  // copies, and rows with no owner yet are skipped until the claim stamps
  // them, when the update trigger above indexes them.
  // tenant-lint: allow derived table
  const backfill = sqlite.prepare(`
    INSERT INTO interactions_fts(rowid, ${INTERACTION_FTS_COLUMNS})
    SELECT ${ftsValues("i")} FROM interactions i
    WHERE i.ownerId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM interactions_fts f WHERE f.rowid = i.rowid)
  `);
  return backfill.run().changes;
}
