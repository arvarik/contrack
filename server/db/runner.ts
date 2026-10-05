// =============================================================================
// The migration runner and the schema_migrations ledger
// =============================================================================
// A schema change is a numbered file in server/db/migrations/, and
// server/db/migrations/index.ts lists the files in order. At boot,
// server/db.ts calls runMigrations. It applies each listed migration that has
// no row in schema_migrations, in list order. A migration and its row commit
// in one transaction, so a migration that throws leaves no change and no row,
// and boot stops with an error that names it.
//
// The same table records each derived structure (the FTS tables, the vec0
// stores and the triggers that feed them) as an `index` row with the version
// it is built at. server/db/indexes.ts owns those rows.
//
// Nothing under server/db/ imports server/db.ts. Every function here takes
// the connection.
// =============================================================================

import type Database from "better-sqlite3";
import { log } from "../utils/logger.ts";

/** The ledger. A migration row has `kind = 'migration'`, an index row `'index'`. */
export const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,               -- '0001_baseline', or an index name such as 'contacts_fts'
  kind TEXT NOT NULL,                -- 'migration' | 'index'
  version INTEGER NOT NULL DEFAULT 1,
  appliedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);`;

/** One schema change, from `server/db/migrations/NNNN_name.ts`. */
export interface Migration {
  /** The file name without `.ts`. It never changes after a release runs it. */
  id: string;
  /** Makes the change. It runs inside the runner's transaction. */
  up: (db: Database.Database) => void;
}

/** Create the ledger when it is missing. */
export function ensureLedger(db: Database.Database): void {
  db.exec(SCHEMA_MIGRATIONS_DDL);
}

function hasLedger(db: Database.Database): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get() !== undefined
  );
}

function hasTables(db: Database.Database): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )
      .get() !== undefined
  );
}

/** The ids of the migrations this database has applied, in id order. */
export function appliedMigrations(db: Database.Database): string[] {
  if (!hasLedger(db)) return [];
  return (
    db
      .prepare(
        "SELECT id FROM schema_migrations WHERE kind = 'migration' ORDER BY id",
      )
      .all() as { id: string }[]
  ).map((row) => row.id);
}

/** The version recorded for a derived structure, or undefined with no row. */
export function readIndexVersion(
  db: Database.Database,
  id: string,
): number | undefined {
  if (!hasLedger(db)) return undefined;
  const row = db
    .prepare(
      "SELECT version FROM schema_migrations WHERE id = ? AND kind = 'index'",
    )
    .get(id) as { version: number } | undefined;
  return row?.version;
}

/**
 * Record the version a derived structure is built at. A row that already
 * holds that version is not written, so a boot that rebuilds nothing changes
 * nothing.
 */
export function recordIndexVersion(
  db: Database.Database,
  id: string,
  version: number,
): void {
  ensureLedger(db);
  db.prepare(
    `INSERT INTO schema_migrations (id, kind, version) VALUES (?, 'index', ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, appliedAt = CURRENT_TIMESTAMP
     WHERE schema_migrations.version IS NOT excluded.version`,
  ).run(id, version);
}

/**
 * Apply every listed migration that has no row, in list order.
 *
 * Refuses to start, before it writes anything, on a database that has tables
 * but no ledger: another program, or Contrack 1, made it. Refuses as well
 * when the database holds a migration this list does not have: a newer build
 * applied it, and this build cannot know what it did.
 *
 * @returns the ids applied by this call
 */
export function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[],
): string[] {
  // The number is the first four characters, and each one is used once.
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].id.slice(0, 4) <= migrations[i - 1].id.slice(0, 4)) {
      throw new Error(
        `Migration ${migrations[i].id} is out of order, or shares its number, in server/db/migrations/index.ts.`,
      );
    }
  }

  if (!hasLedger(db) && hasTables(db)) {
    throw new Error(
      `${db.name} holds tables that Contrack 2 did not create, so it will not change them. Start Contrack with an empty DATA_DIR.`,
    );
  }
  ensureLedger(db);
  const known = new Set(migrations.map((migration) => migration.id));
  const applied = appliedMigrations(db);
  const unknown = applied.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `This database has applied migration ${unknown.join(", ")}, which this build does not have. A newer version of Contrack wrote it. Refusing to start: run that version, or restore a backup from before it.`,
    );
  }

  const done = new Set(applied);
  const ran: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    const started = performance.now();
    try {
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (id, kind) VALUES (?, 'migration')",
        ).run(migration.id);
      })();
    } catch (error) {
      throw new Error(
        `Migration ${migration.id} failed, and nothing it changed was kept. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    ran.push(migration.id);
    log.info(
      "Database",
      `Applied migration ${migration.id} in ${(performance.now() - started).toFixed(0)}ms`,
    );
  }
  return ran;
}
