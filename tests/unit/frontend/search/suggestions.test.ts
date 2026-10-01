// =============================================================================
// Ask Contrack's "Try asking": six questions drawn from the account's pool
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  SUGGESTION_COUNT,
  drawSuggestions,
} from "../../../../src/views/search/suggestions";
import type {
  StarterKind,
  StarterQuestion,
} from "../../../../shared/starterQuestions";

/** A seeded random source, so a draw can be asked for twice. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const question = (kind: StarterKind, n: number): StarterQuestion => ({
  kind,
  text: `${kind} question ${n}`,
});

/** Six of each of four kinds, 24 in all. */
const POOL: StarterQuestion[] = (
  ["industry", "city", "company", "interest"] as StarterKind[]
).flatMap((kind) => [1, 2, 3, 4, 5, 6].map((n) => question(kind, n)));

const kindOf = (text: string) => text.split(" ")[0];

describe("drawSuggestions", () => {
  it("draws six distinct questions, all from the pool", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const drawn = drawSuggestions(POOL, SUGGESTION_COUNT, seeded(seed));
      expect(drawn).toHaveLength(6);
      expect(new Set(drawn).size).toBe(6);
      for (const text of drawn) expect(POOL.map((q) => q.text)).toContain(text);
    }
  });

  it("takes at most two of one kind while other kinds are left", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const drawn = drawSuggestions(POOL, SUGGESTION_COUNT, seeded(seed));
      const counts = new Map<string, number>();
      for (const text of drawn)
        counts.set(kindOf(text), (counts.get(kindOf(text)) ?? 0) + 1);
      expect(Math.max(...counts.values()), `seed ${seed}`).toBeLessThanOrEqual(
        2,
      );
    }
  });

  it("changes from draw to draw", () => {
    const draws = new Set(
      Array.from({ length: 20 }, (_, i) =>
        drawSuggestions(POOL, SUGGESTION_COUNT, seeded(i + 1)).join("|"),
      ),
    );
    // Twenty draws of six from 24 questions: repeats are possible, but not
    // many of them.
    expect(draws.size).toBeGreaterThan(15);
    // And every question in the pool turns up sooner or later.
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) =>
        drawSuggestions(POOL, SUGGESTION_COUNT, seeded(i + 1)),
      ).flat(),
    );
    expect(seen.size).toBe(POOL.length);
  });

  it("fills the draw from one kind when the pool has only that kind", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7].map((n) => question("company", n));
    const drawn = drawSuggestions(pool, SUGGESTION_COUNT, seeded(3));
    expect(drawn).toHaveLength(6);
    expect(new Set(drawn).size).toBe(6);
  });

  it("shows the whole pool when it is smaller than six, and none for none", () => {
    const pool = [question("city", 1), question("tag", 1)];
    expect(drawSuggestions(pool, SUGGESTION_COUNT, seeded(9)).sort()).toEqual(
      ["city question 1", "tag question 1"].sort(),
    );
    expect(drawSuggestions([], SUGGESTION_COUNT, seeded(9))).toEqual([]);
  });

  it("gives each kind a turn before a second from any, and every kind its chance", () => {
    // Eight kinds and six places. Seven general questions among 500 others
    // would almost never be drawn by a shuffle of the whole pool.
    const kinds: StarterKind[] = [
      "industry",
      "city",
      "company",
      "interest",
      "role",
      "pair",
      "tag",
      "general",
    ];
    const pool = kinds.flatMap((kind) =>
      [1, 2, 3, 4, 5].map((n) => question(kind, n)),
    );
    const seen = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const drawn = drawSuggestions(pool, SUGGESTION_COUNT, seeded(seed));
      expect(new Set(drawn.map(kindOf)).size, `seed ${seed}`).toBe(6);
      for (const text of drawn) seen.add(kindOf(text)!);
    }
    // Which six kinds changes from draw to draw.
    expect(seen.size).toBe(kinds.length);
  });

  it("does not change the pool it draws from", () => {
    const pool = [...POOL];
    drawSuggestions(pool, SUGGESTION_COUNT, seeded(4));
    expect(pool).toEqual(POOL);
  });
});
