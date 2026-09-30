// =============================================================================
// Integration Tests — the tenancy schema of a new database
// =============================================================================
// A new database gets its ownership columns, triggers and composite indexes
// from the boot code in server/db.ts. This file reads what the first boot left
// behind, then boots again against the same file.
//
// The second boot matters because every start runs the whole of server/db.ts.
// A step that is not idempotent shows up as a changed schema, a second local
// owner, or a version that moved.
// =============================================================================

import { describe, it, expect, afterAll, vi } from "vitest";
import type Database from "better-sqlite3";
import { sqlite } from "../../server/db.ts";
import { FTS_SCHEMA_VERSION } from "../../server/services/search/ftsIndex.ts";
import { verify } from "../../scripts/tenancy-verify.ts";

/** Every table, index, trigger and view, with the SQL that made it. */
function schemaOf(db: Database.Database): string {
  return JSON.stringify(
    db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all(),
  );
}

function tenancyVersionOf(db: Database.Database): string {
  return (
    db
      .prepare("SELECT value FROM app_settings WHERE key = 'schema.tenancy'")
      .get() as { value: string }
  ).value;
}

function userCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number })
    .n;
}

describe("a new database", () => {
  it("passes every tenancy-verify check", () => {
    const failed = verify(sqlite).filter((c) => !c.ok);
    expect(
      failed.map((c) => `${c.group}: ${c.name} (${c.detail})`),
      "verification queries 1 to 11",
    ).toEqual([]);
  });

  it("has one local owner and no other account", () => {
    const users = sqlite
      .prepare("SELECT username, credentialState, role FROM users")
      .all();
    expect(users).toEqual([
      { username: "local", credentialState: "none", role: "admin" },
    ]);
  });

  it("builds no single-column owner index for any owned table", () => {
    // The eight names an older build made with one line per table. The
    // composite indexes answer every owner-first read, so none of the eight
    // should exist. A LIKE pattern would also catch idx_dedupe_excl_owner,
    // which is a kept composite: that table has nothing to order by, so one
    // column is the whole index.
    const older = [
      "idx_contacts_owner",
      "idx_lists_owner",
      "idx_interactions_owner",
      "idx_action_items_owner",
      "idx_dedupe_suggestions_owner",
      "idx_dedupe_exclusions_owner",
      "idx_dedupe_merge_log_owner",
      "idx_ai_invocations_owner",
    ];
    const built = (
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'index' AND name IN (${older.map(() => "?").join(", ")})`,
        )
        .all(...older) as { name: string }[]
    ).map((r) => r.name);
    expect(built).toEqual([]);
  });
});

describe("booting the same database again", () => {
  const schemaBefore = schemaOf(sqlite);
  const versionBefore = tenancyVersionOf(sqlite);
  let second: Database.Database;

  afterAll(() => {
    second?.close();
    sqlite.close();
  });

  it("changes no table, index or trigger", async () => {
    // A fresh module registry, so server/db.ts runs its whole boot again
    // against the file the first boot left behind.
    vi.resetModules();
    ({ sqlite: second } = await import("../../server/db.ts"));
    expect(schemaOf(second)).toBe(schemaBefore);
  });

  it("keeps the tenancy version and the search schema version", () => {
    expect(tenancyVersionOf(second)).toBe(versionBefore);
    expect(second.pragma("user_version", { simple: true })).toBe(
      FTS_SCHEMA_VERSION,
    );
  });

  it("creates no second local owner", () => {
    expect(userCount(second)).toBe(1);
  });

  it("still passes every tenancy-verify check", () => {
    expect(verify(second).filter((c) => !c.ok)).toEqual([]);
  });
});
