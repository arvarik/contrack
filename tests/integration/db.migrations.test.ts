// =============================================================================
// Integration Tests — the migration ledger
// =============================================================================
// Four guarantees of server/db/runner.ts and the baseline migration, on real
// SQLite files with sqlite-vec loaded:
//
//   1. A new database ends at the last migration, and its schema is the
//      fixture of d67c8a9 plus what the later migrations add.
//   2. A database with tables but no ledger, which Contrack 2 did not make,
//      is refused before anything is written.
//   3. A migration that throws leaves no change and no row, and the error
//      names it.
//   4. server/db/schema.ts names every table and column of the migrated
//      database, and nothing more.
//
// tests/fixtures/schema/v2.0-d67c8a9.sql was written from the code at
// d67c8a9. Its header says how.
// =============================================================================

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { sqlite } from "../../server/db.ts";
import * as schema from "../../server/db/schema.ts";
import { MIGRATIONS } from "../../server/db/migrations/index.ts";
import { appliedMigrations, runMigrations } from "../../server/db/runner.ts";

const FIXTURE = path.resolve(
  import.meta.dirname,
  "../fixtures/schema/v2.0-d67c8a9.sql",
);

/**
 * What the migrations after the fixture add or remake, by name. A new
 * migration adds the name of each table, index and trigger it creates or changes.
 */
const ADDED_SINCE_FIXTURE = [
  "schema_migrations",
  // 0002_events_and_jobs
  "events",
  "idx_events_owner",
  "events_owner_required",
  "event_cursors",
  "jobs",
  "idx_jobs_due",
  "idx_jobs_dedupe",
  // 0003_map_pins remakes these
  "contacts_auto_updated_at",
  "contacts_score_dirty",
  "geocode_cache",
  // 0004_oauth, and api_tokens gains two columns
  "oauth_clients",
  "oauth_requests",
  "idx_oauth_requests_expires",
  "oauth_tokens",
  "idx_oauth_tokens_grant",
  "api_tokens",
  // 0005_dedupe_pair_index
  "idx_dedupe_sugg_contact_b",
];

interface MasterRow {
  type: string;
  name: string;
  sql: string;
}

const byTypeAndName = (a: MasterRow, b: MasterRow) =>
  a.type === b.type
    ? a.name < b.name
      ? -1
      : a.name > b.name
        ? 1
        : 0
    : a.type < b.type
      ? -1
      : 1;

/** Every table, index and trigger, with the SQL that made it. */
function schemaOf(db: Database.Database): MasterRow[] {
  return (
    db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
      )
      .all() as MasterRow[]
  ).sort(byTypeAndName);
}

/**
 * The fixture's rows. Each block starts with "-- <kind> <name>", and a
 * shadow table's statement is a comment, because its virtual table makes it.
 */
function fixtureRows(): MasterRow[] {
  const rows: MasterRow[] = [];
  for (const block of fs.readFileSync(FIXTURE, "utf8").split(/\n\n+/)) {
    const [first, ...rest] = block.trimEnd().split("\n");
    const marker =
      /^-- (table|virtual table|shadow table|index|trigger) (\S+)$/.exec(first);
    if (!marker) continue;
    const [, kind, name] = marker;
    const body =
      kind === "shadow table"
        ? rest.map((line) => line.replace(/^-- ?/, ""))
        : rest;
    rows.push({
      type: kind === "index" || kind === "trigger" ? kind : "table",
      name,
      sql: body.join("\n").replace(/;$/, ""),
    });
  }
  return rows.sort(byTypeAndName);
}

const migrationIds = () => MIGRATIONS.map((migration) => migration.id);

describe("a new database", () => {
  it("ends at the last migration, with the fixture's schema plus what later migrations add", () => {
    expect(appliedMigrations(sqlite)).toEqual(migrationIds());

    const actual = schemaOf(sqlite);
    const added = actual.filter((row) =>
      ADDED_SINCE_FIXTURE.includes(row.name),
    );
    expect(added.map((row) => row.name).sort()).toEqual(
      [...ADDED_SINCE_FIXTURE].sort(),
    );
    // Byte for byte: the baseline moved the old boot code, and a changed
    // character in any statement shows here.
    const kept = (row: MasterRow) => !ADDED_SINCE_FIXTURE.includes(row.name);
    expect(actual.filter(kept)).toEqual(fixtureRows().filter(kept));
  });
});

describe("a database that Contrack 2 did not make", () => {
  it("is refused before anything is written", () => {
    const foreign = new Database(":memory:");
    foreign.exec("CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT)");
    expect(() => runMigrations(foreign, MIGRATIONS)).toThrow(/did not create/);
    expect(schemaOf(foreign).map((row) => row.name)).toEqual(["contacts"]);
    foreign.close();
  });
});

describe("a migration that throws", () => {
  it("leaves no change and no row, and the error names it", () => {
    const schemaBefore = schemaOf(sqlite);
    const broken = {
      id: "9999_broken",
      up(db: Database.Database) {
        db.exec("CREATE TABLE half_done (id TEXT PRIMARY KEY)");
        db.prepare(
          "INSERT INTO app_settings (key, value) VALUES ('half.done', '1')",
        ).run();
        throw new Error("the second step failed");
      },
    };

    expect(() => runMigrations(sqlite, [...MIGRATIONS, broken])).toThrow(
      /9999_broken/,
    );

    expect(schemaOf(sqlite)).toEqual(schemaBefore);
    expect(
      sqlite
        .prepare("SELECT key FROM app_settings WHERE key = 'half.done'")
        .get(),
    ).toBeUndefined();
    expect(appliedMigrations(sqlite)).toEqual(migrationIds());
  });
});

describe("server/db/schema.ts", () => {
  it("names every table and column of the migrated database, and nothing more", () => {
    const declared = Object.fromEntries(
      Object.values(schema)
        .filter((value) => is(value, SQLiteTable))
        .map((table) => {
          const config = getTableConfig(table);
          return [
            config.name,
            config.columns.map((column) => column.name).sort(),
          ];
        }),
    );

    // Left out on purpose: the sqlite_* tables, `__drizzle_migrations` (kept
    // and unused since the baseline), the FTS5 and vec0 virtual tables, and
    // the shadow tables a virtual table makes. Drizzle reads none of them.
    const rows = schemaOf(sqlite).filter((row) => row.type === "table");
    const virtual = rows
      .filter((row) => /^CREATE VIRTUAL TABLE/i.test(row.sql))
      .map((row) => row.name);
    const tables = rows
      .map((row) => row.name)
      .filter(
        (name) =>
          name !== "__drizzle_migrations" &&
          !virtual.some((v) => name === v || name.startsWith(`${v}_`)),
      );
    const migrated = Object.fromEntries(
      tables.map((name) => [
        name,
        (
          sqlite.prepare("SELECT name FROM pragma_table_info(?)").all(name) as {
            name: string;
          }[]
        )
          .map((column) => column.name)
          .sort(),
      ]),
    );

    expect(declared).toEqual(migrated);
  });
});
