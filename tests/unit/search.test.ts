// Reciprocal rank fusion moved to tests/unit/search.rrf.test.ts when it
// gained weights.

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { WEIGHTS } from "../../server/services/search/lexical.ts";
import { COLUMNS } from "../../server/services/search/ftsIndex.ts";

// =============================================================================
// Unit Tests — BM25 column weights are positional
// =============================================================================
// bm25() reads its weights by column position and counts UNINDEXED columns.
// A list that omits the UNINDEXED column shifts every weight one column to
// the left, so "name" silently receives the weight meant for contactId. That
// was the state in v1.5.5. Phase 1 extends this list again when it adds
// ownerTok and cidTok, so the rule is pinned here rather than in a comment.
// =============================================================================

describe("BM25 column weights", () => {
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

  it("declares one contacts_fts weight per column, and zero for contactId", () => {
    const weights = WEIGHTS.split(",").map((w) => Number(w.trim()));
    const columns = COLUMNS.split(",").map((c) => c.trim());

    expect(weights).toHaveLength(columns.length);
    expect(weights.every((w) => Number.isFinite(w))).toBe(true);
    // contactId is UNINDEXED and can never match, so it must not score.
    expect(columns[0]).toBe("contactId");
    expect(weights[0]).toBe(0);
    // name is the most informative column and outranks the rest.
    expect(columns[1]).toBe("name");
    expect(Math.max(...weights)).toBe(weights[1]);
  });
});
