// =============================================================================
// Integration: the passage queries do not depend on stale planner statistics
// =============================================================================
// SQLite plans a query from the row counts it gathered at the last ANALYZE.
// The server runs ANALYZE at boot and PRAGMA optimize once a day, so after a
// big indexing run inside a long-lived server, such as the first boot after an
// import, the counts for `search_passages` are the ones from before it, "2
// rows" for a table that now holds twenty thousand.
//
// With those counts the planner flattened the vector search into the join and
// put `search_passages` first. `search_passage_vectors` is a virtual table, so
// it then ran its k = 300 nearest-neighbour scan once for every passage, and a
// question that took 60 ms took 145 seconds (measured on 5,800 contacts with
// 22,000 passages). A restart hid it, because boot runs ANALYZE.
//
// These tests recreate that state, statistics from a tiny table and then a bulk
// insert, and read the plan the real queries get. A plan is deterministic where
// a timing is not.
// =============================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  ensureLocalOwner,
  refreshPlannerStats,
  sqlite,
} from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { findPassageNeighbors } from "../../server/services/search/localEmbeddings.ts";
import { findPassages } from "../../server/services/search/passages.ts";

const PASSAGES = 3000;
let ownerId: string;

function insertPassages(contactId: string, count: number) {
  const insert = sqlite.prepare(
    `INSERT INTO search_passages
       (id, contactId, ownerId, field, sourceId, sourceHash, active, context, startOffset, endOffset, text)
     VALUES (?, ?, ?, 'note', ?, 'h', 1, ?, 0, 10, ?)`,
  );
  sqlite.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = crypto.randomUUID();
      insert.run(
        id,
        contactId,
        ownerId,
        id,
        `a note about sailing ${i}`,
        `a note about sailing ${i}`,
      );
    }
  })();
}

beforeAll(() => {
  ownerId = ensureLocalOwner();
  sqlite
    .prepare(
      "INSERT INTO contacts (id, name, ownerId) VALUES ('plan-1', 'Plan One', ?)",
    )
    .run(ownerId);
  // The statistics as a server has them at boot, from a table of two rows.
  insertPassages("plan-1", 2);
  sqlite.exec("ANALYZE");
  // Then the work the server does after an import: thousands of passages,
  // and no ANALYZE until tomorrow.
  insertPassages("plan-1", PASSAGES);
});

/** The plan of every statement `run` executes through `.all`, one line each. */
function plansOf(run: () => void): string[] {
  const captured: { sql: string; args: unknown[] }[] = [];
  const original = sqlite.prepare.bind(sqlite);
  const spy = vi.spyOn(sqlite, "prepare").mockImplementation((sql: string) => {
    const statement = original(sql);
    const all = statement.all.bind(statement);
    statement.all = (...args: unknown[]) => {
      captured.push({ sql, args });
      return all(...args);
    };
    return statement;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return captured.map(({ sql, args }) =>
    (original(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
      .map((row) => row.detail)
      .join(" | "),
  );
}

describe("the passage queries, with statistics from before a bulk index", () => {
  it("starts the vector search from the vector table, so it runs once", () => {
    const [plan] = plansOf(() =>
      findPassageNeighbors(scopeForOwnerId(ownerId), new Float32Array(384)),
    );
    expect(plan).toBeDefined();
    // A plan that scans `search_passages` first re-runs the nearest-neighbour
    // search for each of its rows.
    expect(plan.split(" | ")[0]).toContain("search_passage_vectors");
  });

  it("starts the passage keyword query from the full-text index", () => {
    const [plan] = plansOf(() =>
      findPassages(scopeForOwnerId(ownerId), "sailing"),
    );
    expect(plan).toBeDefined();
    // `f` is the full-text table. Before, the plan began with `SCAN c`, the
    // contacts, and looked for a match in each.
    expect(plan.split(" | ")[0]).toMatch(/^SCAN f VIRTUAL TABLE/);
  });
});

describe("refreshPlannerStats", () => {
  it("makes the planner's row counts follow a bulk insert", () => {
    const counted = () =>
      Number(
        (
          sqlite
            .prepare(
              "SELECT stat FROM sqlite_stat1 WHERE tbl = 'search_passages' AND idx = 'idx_search_passages_owner'",
            )
            .get() as { stat: string }
        ).stat.split(" ")[0],
      );
    expect(counted()).toBeLessThan(10);
    refreshPlannerStats();
    expect(counted()).toBeGreaterThanOrEqual(PASSAGES);
  });
});
