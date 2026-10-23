// =============================================================================
// Migration 0002_sign_in_identities
// =============================================================================
// Links an OIDC provider's (issuer, subject) to an account. One identity per
// account per provider.
//
// What a migration may do: create, alter and drop tables, indexes and
// triggers, and move or fix data with SQL. It runs once per database, inside
// one transaction with its row in schema_migrations. If it throws, nothing it
// did is kept, and the server stops with this id in the error.
//
// What it may not do:
// - Import server/db.ts or a service. The code it calls can change later, and
//   this file must keep doing what it did when it shipped. Write the SQL here.
// - Change a migration that has shipped. Write a new one.
// - Run BEGIN, COMMIT, VACUUM, or a PRAGMA that cannot run in a transaction.
// - Build the FTS tables, the vec0 stores or the triggers that feed them. They
//   are rebuilt from code: raise the version in server/db/indexes.ts.
//
// What goes with it:
// - Every table and column it adds, mirrored in server/db/schema.ts, and the
//   name of every object it adds in ADDED_SINCE_FIXTURE in
//   tests/integration/db.migrations.test.ts. That test checks both.
// - A table with ownerId: OWNED_TABLES in server/db.ts and
//   scripts/tenant-lint.mjs, the delete loop of purgeOwner, and its owner
//   triggers here.
// - A new contacts column: drop and create the contacts_auto_updated_at and
//   contacts_score_dirty triggers again, with the column list of
//   contactEditColumns (server/db/helpers.ts).
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE user_identities (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      lastUsedAt TEXT,
      UNIQUE (issuer, subject),
      UNIQUE (userId, issuer)
    );
  `);
}
