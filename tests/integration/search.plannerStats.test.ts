// Integration: the passage queries do not depend on stale planner statistics.
// SQLite plans from the counts of its last ANALYZE. Counts from a tiny table
// can put `search_passages` first and run the k = 300 nearest-neighbor search
// once per passage (145 s for a question that takes 60 ms). These tests make
// that state, counts from a tiny table and then a bulk insert, and read the
// plan the real queries get, which is deterministic where a timing is not.

import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  ensureLocalOwner,
  refreshPlannerStats,
  sqlite,
} from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { findPassageNeighbors } from "../../server/services/search/vectorIndex.ts";
import { findPassages } from "../../server/services/search/passages.ts";

const PASSAGES = 3000;
let ownerId: string;

function insertPassages(count: number) {
  const insert = sqlite.prepare(
    `INSERT INTO search_passages
       (id, contactId, ownerId, field, sourceId, sourceHash, active, context, startOffset, endOffset, text)
     VALUES (@id, 'plan-1', @ownerId, 'note', @id, 'h', 1, @text, 0, 10, @text)`,
  );
  sqlite.transaction(() => {
    for (let i = 0; i < count; i++)
      insert.run({ id: crypto.randomUUID(), ownerId, text: `sailing ${i}` });
  })();
}

beforeAll(() => {
  ownerId = ensureLocalOwner();
  sqlite
    .prepare(
      "INSERT INTO contacts (id, name, ownerId) VALUES ('plan-1', 'Plan One', ?)",
    )
    .run(ownerId);
  // The counts a server has at boot, then the passages an import writes.
  insertPassages(2);
  sqlite.exec("ANALYZE");
  insertPassages(PASSAGES);
});

/** The first step of the plan of the one statement `run` reads with `.all`. */
function firstStep(run: () => void): string {
  const prepare = sqlite.prepare.bind(sqlite);
  let step = "";
  const spy = vi.spyOn(sqlite, "prepare").mockImplementation((sql: string) => {
    const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`);
    return {
      all: (...args: unknown[]) => {
        step = (plan.all(...args) as { detail: string }[])[0]!.detail;
        return [];
      },
    } as never;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return step;
}

describe("the passage queries, with statistics from before a bulk index", () => {
  it("start from the vector search and from the full-text index", () => {
    const scope = scopeForOwnerId(ownerId);
    // Starting from `search_passages` ran the nearest-neighbor search once
    // for each of its rows, and the keyword query scanned the contacts first.
    expect(
      firstStep(() => findPassageNeighbors(scope, new Float32Array(384))),
    ).toContain("search_passage_vectors");
    expect(firstStep(() => findPassages(scope, "sailing"))).toMatch(
      /^SCAN f VIRTUAL TABLE/,
    );
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
