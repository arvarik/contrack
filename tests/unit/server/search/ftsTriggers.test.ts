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
//     silently returns nothing. The scoped searches in
//     tests/integration/search.index.test.ts check it.
//     tests/unit/server/tenancy/scope.test.ts pins the helper to the same SQL
//     form, and the snapshot holds the trigger's copy of it.
//   • `contacts_au` fires on `ownerId`, so reassigning a contact reindexes it.
//
// The snapshot is here to make a change to any of them deliberate.
//
// The BM25 weights are positional. bm25() counts the UNINDEXED contactId
// column, so a list one entry short shifts every weight one column to the
// left, and "name" gets the weight meant for contactId. That was the state in
// v1.5.5.
// =============================================================================

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  COLUMNS,
  SEARCH_COLUMNS,
  contactTriggerSql,
} from "../../../../server/services/search/ftsIndex.ts";
import { WEIGHTS } from "../../../../server/services/search/lexical.ts";

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
  it("applies weights by column position, including the UNINDEXED column", () => {
    const db = new Database(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(id UNINDEXED, a, b)");
    const insert = db.prepare("INSERT INTO t(id, a, b) VALUES (?, ?, ?)");
    insert.run("in-a", "needle", "filler");
    insert.run("in-b", "filler", "needle");

    // bm25() returns a negative score, so ascending order is best-first.
    const best = (weights: string) =>
      (
        db
          .prepare(
            `SELECT id FROM t WHERE t MATCH 'needle' ORDER BY bm25(t, ${weights})`,
          )
          .all() as { id: string }[]
      )[0].id;

    // Position 0 is the UNINDEXED id, position 1 is a, position 2 is b.
    expect(best("0.0, 10.0, 1.0")).toBe("in-a");
    expect(best("0.0, 1.0, 10.0")).toBe("in-b");
    db.close();
  });

  it("declares one weight per FTS column, none for contactId or ownerTok, the most for name and the least text for an address", () => {
    const weights = WEIGHTS.split(",").map((w) => Number(w.trim()));
    const columns = COLUMNS.split(",").map((c) => c.trim());

    expect(
      weights,
      `${weights.length} weights for ${columns.length} columns`,
    ).toHaveLength(columns.length);
    expect(weights.every((w) => Number.isFinite(w))).toBe(true);
    // contactId is UNINDEXED and can never match, so it must not score.
    expect(columns[0]).toBe("contactId");
    expect(weights[0]).toBe(0);
    // ownerTok is a scoping filter, so it must not score either.
    expect(weights[columns.indexOf("ownerTok")]).toBe(0);
    // name is the most informative column and outranks the rest.
    expect(columns[1]).toBe("name");
    expect(Math.max(...weights)).toBe(weights[1]);
    // An address counts, below every field a person writes about someone.
    const address = weights[columns.indexOf("addresses")]!;
    expect(address).toBeGreaterThan(0);
    for (const [i, column] of columns.entries())
      if (
        !["contactId", "addresses", "searchExpansion", "ownerTok"].includes(
          column,
        )
      )
        expect(address, column).toBeLessThan(weights[i]!);
  });
});
