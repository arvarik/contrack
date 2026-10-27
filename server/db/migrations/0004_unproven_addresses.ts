// =============================================================================
// Migration 0004_unproven_addresses
// =============================================================================
// Takes back the trust 0003_address_trust gave an account whose email nobody
// vouched for. 0003 trusted every existing account, but email matching first
// shipped with it, so no admin had vouched for anything. These accounts now
// keep their trust only where the rules for a new account would give it:
// - Kept: an admin, an account an admin made, and an account that accepted an
//   invitation with the invited address.
// - Taken back: an account from open registration (no createdBy), and one
//   that accepted an invitation with another address or with none.
// A mailed link proved after 0003 has a later stamp, so it stays. An email
// that a member changed before 0003 left no record, so it stays trusted.
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
    UPDATE users SET emailTrustedAt = NULL
    WHERE emailTrustedAt <= (
        SELECT appliedAt FROM schema_migrations WHERE id = '0003_address_trust'
      )
      AND role <> 'admin'
      AND (
        createdBy IS NULL
        OR EXISTS (
          SELECT 1 FROM invitations
          WHERE invitations.acceptedBy = users.id
            AND (invitations.email IS NULL
                 OR invitations.email <> lower(trim(users.email)))
        )
      );
  `);
}
