// =============================================================================
// Unit Tests — the note index triggers, and the index on a real connection
// =============================================================================
// Two of the contact index's properties, pinned the same way: every delete
// is by rowid, and every insert carries the owner token. Then two things
// only a connection shows: an install fills in the rows the index is
// missing, and a rolled back edit leaves the index as it was.
// tests/integration/search.interactions.test.ts pins the rest on the real
// schema: the indexed text, the stemming, the owner fill, and the edit,
// delete and cascade paths.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  INTERACTION_FTS_COLUMNS,
  INTERACTION_WEIGHTS,
  NOTE_TEXT_FUNCTION,
  installInteractionSearchIndex,
  interactionTriggerSql,
} from "../../server/services/search/interactionFtsIndex.ts";
import { ownerToken } from "../../server/tenancy/scope.ts";

const sql = interactionTriggerSql();

describe("interaction FTS trigger SQL", () => {
  it("never deletes on the UNINDEXED interactionId column", () => {
    expect(sql).not.toMatch(
      /DELETE FROM interactions_fts\s+WHERE\s+interactionId/i,
    );
    const deletes = sql.match(/DELETE FROM interactions_fts[^;]*/gi) ?? [];
    expect(deletes).toHaveLength(2); // interactions_fts_au and interactions_fts_ad
    for (const statement of deletes) {
      expect(statement).toMatch(/WHERE rowid = old\.rowid/);
    }
  });

  it("writes ownerTok through the note text function on every insert", () => {
    const inserts = sql.match(/INSERT INTO interactions_fts[^;]*/gi) ?? [];
    expect(inserts).toHaveLength(2); // interactions_fts_ai and interactions_fts_au
    for (const statement of inserts) {
      expect(statement).toContain("ownerTok");
      expect(statement).toContain("'o' || replace(new.ownerId, '-', '')");
      expect(statement).toContain(`${NOTE_TEXT_FUNCTION}(new.content)`);
    }
  });

  it("indexes a row only once it has an owner", () => {
    const insertTrigger = sql.slice(
      sql.indexOf("CREATE TRIGGER interactions_fts_ai"),
    );
    expect(insertTrigger.slice(0, insertTrigger.indexOf("BEGIN"))).toContain(
      "WHEN new.ownerId IS NOT NULL",
    );
    const updateTrigger = sql.slice(
      sql.indexOf("CREATE TRIGGER interactions_fts_au"),
    );
    expect(updateTrigger.slice(0, updateTrigger.indexOf("END;"))).toContain(
      "WHERE new.ownerId IS NOT NULL",
    );
  });

  it("declares one bm25 weight per column, none for the id or the owner", () => {
    const columns = INTERACTION_FTS_COLUMNS.split(",").map((c) => c.trim());
    const weights = INTERACTION_WEIGHTS.split(",").map((w) => Number(w.trim()));
    expect(weights).toHaveLength(columns.length);
    expect(weights[columns.indexOf("interactionId")]).toBe(0);
    expect(weights[columns.indexOf("ownerTok")]).toBe(0);
    expect(weights[columns.indexOf("title")]).toBeGreaterThan(
      weights[columns.indexOf("content")],
    );
  });
});

describe("the note index on a connection", () => {
  let db: Database.Database;
  const owner = "3f2c1d0e-9a84-4b7c-8d6e-5f4a3b2c1d0e";
  const token = ownerToken({ ownerId: owner } as never);

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE interactions (
        id TEXT PRIMARY KEY,
        contactId TEXT,
        title TEXT NOT NULL,
        content TEXT,
        ownerId TEXT
      );
    `);
  });
  afterEach(() => db.close());

  const rows = () =>
    db
      .prepare(
        "SELECT rowid, interactionId, title, content, ownerTok FROM interactions_fts ORDER BY rowid",
      )
      .all() as {
      rowid: number;
      interactionId: string;
      title: string;
      content: string | null;
      ownerTok: string;
    }[];
  const find = (expression: string) =>
    (
      db
        .prepare(
          "SELECT interactionId FROM interactions_fts WHERE interactions_fts MATCH ? ORDER BY rank",
        )
        .all(`ownerTok:${token} AND (${expression})`) as {
        interactionId: string;
      }[]
    ).map((r) => r.interactionId);

  it("backfills rows the index is missing, and only those, on a later install", () => {
    db.prepare(
      "INSERT INTO interactions VALUES ('i1', 'c1', 'Before', 'the index existed', ?)",
    ).run(owner);
    db.prepare(
      "INSERT INTO interactions (id, contactId, title, content) VALUES ('i0', 'c1', 'Unowned', 'row')",
    ).run();
    expect(installInteractionSearchIndex(db, false)).toBe(1);
    expect(rows().map((r) => r.interactionId)).toEqual(["i1"]);
    // Installing again writes nothing and keeps what is there.
    expect(installInteractionSearchIndex(db, false)).toBe(0);
    expect(rows()).toHaveLength(1);
    // A rebuild drops and refills.
    expect(installInteractionSearchIndex(db, true)).toBe(1);
    expect(rows()).toHaveLength(1);
  });

  it("keeps the index inside a rolled back transaction", () => {
    installInteractionSearchIndex(db, true);
    db.prepare(
      "INSERT INTO interactions VALUES ('i1', 'c1', 'A', 'sailing', ?)",
    ).run(owner);
    expect(() =>
      db.transaction(() => {
        db.prepare(
          "UPDATE interactions SET content = 'changed' WHERE id = 'i1'",
        ).run();
        throw new Error("rollback");
      })(),
    ).toThrow("rollback");
    expect(find('"sailing"')).toEqual(["i1"]);
    expect(find('"changed"')).toEqual([]);
  });
});
