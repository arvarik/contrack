// =============================================================================
// tenancy-verify — check that a database really is fully owned
// =============================================================================
// Opens the database read-only and runs the invariants Phase 1 is supposed to
// establish. An operator runs this after upgrading; the migration test runs the
// same checks against a fixture built from a 1.5.5-shaped database.
//
// The expectations are restated here rather than imported from server/db.ts on
// purpose. Importing that module would run the migration, so the script would
// be checking its own work. A second, independent statement of the invariant
// is what makes this worth running at all.
//
//   npm run tenancy:verify
//   DATA_DIR=/path/to/data npm run tenancy:verify
// =============================================================================

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import path from "node:path";

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "curator.db")
  : "curator.db";

const OWNED_TABLES = [
  "contacts",
  "lists",
  "interactions",
  "action_items",
  "dedupe_suggestions",
  "dedupe_exclusions",
  "dedupe_merge_log",
  "ai_invocations",
];

/**
 * Triggers that must exist when the migration is done.
 *
 * The first group is dropped around the ownership claim and recreated by
 * sections 3 to 6 of server/db.ts on the same boot. A crash in between leaves
 * them missing, which this catches. The second group is the ownership
 * invariant itself.
 */
const REQUIRED_TRIGGERS = [
  // Dropped for the claim, recreated on the same boot.
  "contacts_ai",
  "contacts_au",
  "contacts_ad",
  "search_revision_INSERT",
  "search_revision_UPDATE",
  "search_revision_DELETE",
  "contacts_auto_updated_at",
  "interactions_auto_updated_at",
  "action_items_auto_updated_at",
  "action_items_sync_insert",
  "action_items_sync_update",
  "action_items_sync_delete",
  "search_vector_update",
  "search_vector_delete",
  // The ownership invariant.
  "contacts_owner_required",
  "lists_owner_required",
  "dedupe_merge_log_owner_required",
  "ai_invocations_owner_required",
  "interactions_owner_fill",
  "interactions_owner_check",
  "action_items_owner_fill",
  "action_items_owner_check",
  "dedupe_suggestions_owner_fill",
  "dedupe_suggestions_owner_check",
  "dedupe_exclusions_owner_fill",
  "dedupe_exclusions_owner_check",
  "contacts_owner_propagate",
];

interface Check {
  group: number;
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(group: number, name: string, ok: boolean, detail = ""): void {
  checks.push({ group, name, ok, detail });
}

export function verify(db: Database.Database): Check[] {
  checks.length = 0;
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  // 1. No unowned rows anywhere.
  for (const table of OWNED_TABLES) {
    const n = count(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId IS NULL`);
    check(1, `${table} has no unowned rows`, n === 0, `${n} unowned`);
  }

  // 2. A child row's owner is its parent contact's owner.
  const childMismatch: [string, string][] = [
    [
      "interactions",
      `SELECT COUNT(*) AS n FROM interactions i JOIN contacts c ON c.id = i.contactId
        WHERE i.ownerId != c.ownerId`,
    ],
    [
      "action_items",
      `SELECT COUNT(*) AS n FROM action_items a JOIN contacts c ON c.id = a.contactId
        WHERE a.ownerId != c.ownerId`,
    ],
    [
      "dedupe_suggestions",
      `SELECT COUNT(*) AS n FROM dedupe_suggestions s
         JOIN contacts a ON a.id = s.contactIdA JOIN contacts b ON b.id = s.contactIdB
        WHERE s.ownerId != a.ownerId OR s.ownerId != b.ownerId`,
    ],
    [
      "dedupe_exclusions",
      `SELECT COUNT(*) AS n FROM dedupe_exclusions e
         JOIN contacts a ON a.id = e.contactIdA JOIN contacts b ON b.id = e.contactIdB
        WHERE e.ownerId != a.ownerId OR e.ownerId != b.ownerId`,
    ],
  ];
  for (const [label, sql] of childMismatch) {
    const n = count(sql);
    check(2, `${label} owner matches its contact`, n === 0, `${n} mismatched`);
  }

  // 3. Every active contact is in the FTS index, and nothing else is.
  const ftsRows = count("SELECT COUNT(*) AS n FROM contacts_fts");
  const activeRows = count(
    `SELECT COUNT(*) AS n FROM contacts
      WHERE isGhost = 0 AND COALESCE(isArchived, 0) = 0
        AND canonicalId IS NULL AND deletedAt IS NULL`,
  );
  check(
    3,
    "FTS row count equals active contacts",
    ftsRows === activeRows,
    `${ftsRows} indexed, ${activeRows} active`,
  );

  // 4 and 8. Every FTS row carries its contact's owner token.
  const badToken = count(
    `SELECT COUNT(*) AS n FROM contacts_fts f JOIN contacts c ON c.id = f.contactId
      WHERE f.ownerTok != 'o' || replace(c.ownerId, '-', '')`,
  );
  check(
    4,
    "every FTS row has the right ownerTok",
    badToken === 0,
    `${badToken} wrong`,
  );
  const emptyToken = count(
    `SELECT COUNT(*) AS n FROM contacts_fts WHERE ownerTok IS NULL OR ownerTok = 'o'`,
  );
  check(
    8,
    "no FTS row has an empty ownerTok",
    emptyToken === 0,
    `${emptyToken} empty`,
  );

  // 5. Both vector stores are partitioned.
  for (const table of ["search_embeddings", "contact_embeddings"]) {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
      .get(table) as { sql?: string } | undefined;
    const ok = !!row?.sql && /PARTITION KEY/i.test(row.sql);
    check(5, `${table} has a PARTITION KEY`, ok, ok ? "" : "missing");
  }

  // 6. No legacy flat upload URLs remain.
  const flatAvatars = count(
    `SELECT COUNT(*) AS n FROM contacts WHERE avatarUrl LIKE '/uploads/avatars/%'`,
  );
  check(6, "no flat avatar URLs", flatAvatars === 0, `${flatAvatars} left`);
  const flatFiles = count(
    `SELECT COUNT(*) AS n FROM interactions
      WHERE fileUrl LIKE '/uploads/%' AND fileUrl NOT LIKE '/uploads/u/%'
        AND fileUrl NOT LIKE '/uploads/logos/%'`,
  );
  check(6, "no flat attachment URLs", flatFiles === 0, `${flatFiles} left`);

  // 7. At most one local owner.
  const locals = count(
    `SELECT COUNT(*) AS n FROM users WHERE credentialState = 'none'`,
  );
  check(7, "at most one local owner", locals <= 1, `${locals} found`);

  // 9. No vector row with a NULL partition. An INSERT that omits the partition
  //    key succeeds silently on sqlite-vec, so this is the only way to see it.
  for (const table of ["search_embeddings", "contact_embeddings"]) {
    const n = count(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId IS NULL`);
    check(9, `${table} has no NULL partitions`, n === 0, `${n} null`);
  }

  // 10. Every vector belongs to an existing contact of the same owner.
  for (const table of ["search_embeddings", "contact_embeddings"]) {
    const n = count(
      `SELECT COUNT(*) AS n FROM ${table} e LEFT JOIN contacts c ON c.id = e.contactId
        WHERE c.id IS NULL OR c.ownerId != e.ownerId`,
    );
    check(
      10,
      `${table} rows match their contact's owner`,
      n === 0,
      `${n} wrong`,
    );
  }

  // 11. Every trigger the migration drops is back, and the invariant is armed.
  const present = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as { name: string }[]
    ).map((r) => r.name),
  );
  const missing = REQUIRED_TRIGGERS.filter((t) => !present.has(t));
  check(
    11,
    `all ${REQUIRED_TRIGGERS.length} required triggers exist`,
    missing.length === 0,
    missing.join(", "),
  );

  return [...checks];
}

function main(): void {
  const db = new Database(DB_PATH, { readonly: true });
  sqliteVec.load(db);
  const results = verify(db);
  db.close();

  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`tenancy-verify: ${DB_PATH}\n`);
  for (const r of results) {
    const mark = r.ok ? "pass" : "FAIL";
    const detail = !r.ok && r.detail ? `  (${r.detail})` : "";
    console.log(
      `  ${mark}  ${String(r.group).padStart(2)}  ${r.name.padEnd(width)}${detail}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length) {
    console.error(
      `tenancy-verify: ${failed.length} of ${results.length} checks failed`,
    );
    process.exit(1);
  }
  console.log(`tenancy-verify: all ${results.length} checks passed`);
}

// Run only as a CLI, so the migration test can import verify().
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main();
}
