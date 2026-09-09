// =============================================================================
// Unit Tests — the generated FTS trigger SQL
// =============================================================================
// Three properties of this SQL are load-bearing and none of them is obvious
// from reading a trigger body in isolation:
//
//   • Deletes go through `rowid`. FTS5 pushes down only MATCH, rowid and rank,
//     so a delete on the UNINDEXED `contactId` column is a full scan of the
//     virtual table. It was one once, and it cost 0.50 ms per contact update
//     against 0.04 ms now.
//   • Every row carries `ownerTok`, and it is the same string
//     `ownerToken()` builds. Phase 2 scopes search by matching on it, and a
//     mismatch between the SQL and the helper means every scoped search
//     silently returns nothing.
//   • `contacts_au` fires on `ownerId`, so reassigning a contact reindexes it.
//
// The snapshot is here to make a change to any of them deliberate.
// =============================================================================

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  COLUMNS,
  SEARCH_COLUMNS,
  contactTriggerSql,
} from "../../server/services/search/ftsIndex.ts";
import { WEIGHTS } from "../../server/services/search/lexical.ts";
import { ownerToken } from "../../server/tenancy/scope.ts";

const sql = contactTriggerSql();

describe("FTS trigger SQL", () => {
  it("matches its snapshot", () => {
    expect(sql).toMatchSnapshot();
  });

  it("never deletes on the UNINDEXED contactId column", () => {
    // The regression this guards is invisible: the trigger still works, it
    // just scans the whole index every time it fires.
    expect(sql).not.toMatch(/DELETE FROM contacts_fts\s+WHERE\s+contactId/i);
    const deletes = sql.match(/DELETE FROM contacts_fts[^;]*/gi) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const statement of deletes) {
      expect(statement).toMatch(/WHERE rowid = old\.rowid/);
    }
  });

  it("writes ownerTok on every insert", () => {
    const inserts = sql.match(/INSERT INTO contacts_fts[^;]*/gi) ?? [];
    expect(inserts.length).toBe(2); // contacts_ai and contacts_au
    for (const statement of inserts) {
      expect(statement).toContain("ownerTok");
      expect(statement).toContain("'o' || replace(c.ownerId, '-', '')");
    }
  });

  it("keeps the deletedAt guard on every insert", () => {
    // contacts_ai lacked this before the search rework: a contact created
    // already-trashed went into the index and stayed there.
    for (const trigger of ["contacts_ai", "contacts_au"]) {
      const body = sql.slice(sql.indexOf(`CREATE TRIGGER ${trigger} `));
      expect(body.slice(0, body.indexOf("END;"))).toContain(
        "c.deletedAt IS NULL",
      );
    }
  });

  it("reindexes a contact when its owner changes", () => {
    expect(SEARCH_COLUMNS).toContain("ownerId");
    expect(sql).toContain(`AFTER UPDATE OF ${SEARCH_COLUMNS} ON contacts`);
  });
});

describe("BM25 weights", () => {
  it("declares one weight per FTS column", () => {
    const columns = COLUMNS.split(",").length;
    const weights = WEIGHTS.split(",").length;
    expect(weights, `${weights} weights for ${columns} columns`).toBe(columns);
  });

  it("gives contactId and ownerTok no ranking influence", () => {
    const weights = WEIGHTS.split(",").map((w) => Number(w.trim()));
    const columns = COLUMNS.split(",").map((c) => c.trim());
    expect(weights[columns.indexOf("contactId")]).toBe(0);
    expect(weights[columns.indexOf("ownerTok")]).toBe(0);
  });
});

describe("the owner token", () => {
  it("is one FTS5 term, and the same string the SQL builds", () => {
    const db = new Database(":memory:");
    try {
      const id = "3f2c1d0e-9a84-4b7c-8d6e-5f4a3b2c1d0e";
      const fromSql = (
        db.prepare("SELECT 'o' || replace(?, '-', '') AS tok").get(id) as {
          tok: string;
        }
      ).tok;
      expect(ownerToken({ ownerId: id } as never)).toBe(fromSql);

      // A raw UUID would be five terms under unicode61, which is why the
      // hyphens come out. fts5vocab is how that gets checked rather than
      // assumed.
      db.exec(`CREATE VIRTUAL TABLE t USING fts5(ownerTok);
        CREATE VIRTUAL TABLE tok_v USING fts5vocab(t, 'row');`);
      db.prepare("INSERT INTO t (ownerTok) VALUES (?)").run(fromSql);
      const terms = db.prepare("SELECT term FROM tok_v").all() as {
        term: string;
      }[];
      expect(terms).toHaveLength(1);
      expect(terms[0].term).toBe(fromSql.toLowerCase());
    } finally {
      db.close();
    }
  });
});
