// =============================================================================
// Unit Tests — the note index triggers, and the index on a real connection
// =============================================================================
// Same three properties as the contact index, pinned the same way: every
// delete is by rowid, every insert carries the owner token, and an owner
// change re-indexes the row. Then the whole thing on an in-memory database
// with the two tables it needs, because "the trigger compiles" and "the
// trigger indexes the right text" are different claims.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  INTERACTION_FTS_COLUMNS,
  INTERACTION_SEARCH_COLUMNS,
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

  it("re-indexes a note when its owner is filled in", () => {
    expect(INTERACTION_SEARCH_COLUMNS).toContain("ownerId");
    expect(sql).toContain(
      `AFTER UPDATE OF ${INTERACTION_SEARCH_COLUMNS} ON interactions`,
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
      CREATE TABLE contacts (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE interactions (
        id TEXT PRIMARY KEY,
        contactId TEXT REFERENCES contacts(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT,
        ownerId TEXT
      );
      CREATE TRIGGER interactions_owner_fill AFTER INSERT ON interactions
      WHEN NEW.ownerId IS NULL
      BEGIN
        UPDATE interactions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
         WHERE id = NEW.id;
      END;
      INSERT INTO contacts VALUES ('c1', '${owner}');
    `);
    db.pragma("foreign_keys = ON");
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

  it("indexes the readable text of a note as it is written", () => {
    installInteractionSearchIndex(db, true);
    db.prepare(
      "INSERT INTO interactions VALUES ('i1', 'c1', 'Coffee', '<p>Discussed <strong>hiring</strong> with <span data-id=\"abc-123\">@Sam</span></p>', ?)",
    ).run(owner);
    expect(rows()).toEqual([
      {
        rowid: 1,
        interactionId: "i1",
        title: "Coffee",
        content: "Discussed hiring with @Sam",
        ownerTok: token,
      },
    ]);
    expect(find('"strong"')).toEqual([]);
    expect(find('"abc"*')).toEqual([]);
    expect(find('"sam"')).toEqual(["i1"]);
  });

  it("stems and folds diacritics on both sides of a match", () => {
    installInteractionSearchIndex(db, true);
    db.prepare(
      "INSERT INTO interactions VALUES ('i1', 'c1', 'Hiring freeze', 'Two engineers. Café budget approved.', ?)",
    ).run(owner);
    expect(find('"hire"')).toEqual(["i1"]);
    expect(find('"engineer"*')).toEqual(["i1"]);
    expect(find('"cafe"')).toEqual(["i1"]);
  });

  it("waits for the owner fill and then indexes the row once", () => {
    installInteractionSearchIndex(db, true);
    db.prepare(
      "INSERT INTO interactions (id, contactId, title, content) VALUES ('i1', 'c1', 'No owner yet', 'text')",
    ).run();
    expect(rows()).toEqual([
      {
        rowid: 1,
        interactionId: "i1",
        title: "No owner yet",
        content: "text",
        ownerTok: token,
      },
    ]);
  });

  it("follows an edit, a delete and a cascade", () => {
    installInteractionSearchIndex(db, true);
    db.prepare(
      "INSERT INTO interactions VALUES ('i1', 'c1', 'A', 'sailing', ?)",
    ).run(owner);
    db.prepare(
      "INSERT INTO interactions VALUES ('i2', 'c1', 'B', 'boats', ?)",
    ).run(owner);
    db.prepare(
      "UPDATE interactions SET content = '<p>hiring</p>' WHERE id = 'i1'",
    ).run();
    expect(find('"sailing"')).toEqual([]);
    expect(find('"hiring"')).toEqual(["i1"]);
    db.prepare("DELETE FROM interactions WHERE id = 'i2'").run();
    expect(rows().map((r) => r.interactionId)).toEqual(["i1"]);
    db.prepare("DELETE FROM contacts WHERE id = 'c1'").run();
    expect(rows()).toEqual([]);
  });

  it("backfills rows the index is missing, and only those, on a later install", () => {
    db.prepare(
      "INSERT INTO interactions VALUES ('i1', 'c1', 'Before', 'the index existed', ?)",
    ).run(owner);
    db.prepare(
      "INSERT INTO interactions (id, contactId, title, content) VALUES ('i0', 'c1', 'Unowned', 'row')",
    ).run();
    db.prepare("UPDATE interactions SET ownerId = NULL WHERE id = 'i0'").run();
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
