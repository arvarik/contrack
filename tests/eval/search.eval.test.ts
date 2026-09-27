// =============================================================================
// Search quality gate
// =============================================================================
// Three hundred contacts, seventy queries, five rankings, two numbers each,
// all compared with a committed baseline.
//
// WHEN THIS FAILS. Either a change moved search ranking and the baseline has
// not caught up, or a change moved search ranking and nobody meant it to. The
// gate cannot tell those apart, which is the point: it asks a person. If the
// move is intended, run
//
//   npm run eval:record
//
// and commit the baseline diff with the change. That diff is the evidence
// that "better" is better. If the move is not intended, the numbers say which
// kind of query lost ground, which is usually enough to find the cause.
//
// The gate fails on an improvement as well as on a regression. A one-sided
// gate lets ranking drift upward on one kind of query and downward on another
// without anybody looking, because the total still passes.
//
// WHAT IS REAL HERE. The database, the FTS5 index and its triggers, the BM25
// weights, the int8 vec0 store and its scale, the KNN, the reciprocal rank
// fusion, and the cross-encoder stage's budget, cut and reorder. What is
// recorded is the embedding of each contact and each query, and the
// cross-encoder's score for each (question, profile) pair it reads: the
// models run in `scripts/record-search-eval.ts`, not here, so this needs no
// model, no download and no network.
//
// WHAT IT CATCHES, measured by breaking the code on purpose:
//
//   the BM25 weight string shifted one column      4 failures
//   the `broad` OR fallback removed from retrieval 2 failures
//   the name weight dropped from 10 to 1           1 failure
//   RRF_K changed from 15 to 60                    passes
//   the vector channel limit cut from 100 to 10    passes
//
// The last two are honest passes, not blind spots to apologise for. Both
// reorder the tail and neither moves a contact into or out of the first ten
// on this corpus, which is another way of saying neither changes what a
// person would see. recall@10 and MRR measure the answer, not the arithmetic
// that produced it.
// =============================================================================

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  /** Query text to its recorded vector. Filled before the first search. */
  byText: new Map<string, Float32Array>(),
}));

// `embedText` is the one place a model would be needed, and
// `isSearchEmbeddingReady` is its gate. Everything else in the module —
// `upsertSearchEmbeddings`, `findSearchNeighbors`, `getSearchEmbeddingCount` —
// stays real, because the KNN is a thing under test and not a thing to fake.
vi.mock(
  "../../server/services/search/localEmbeddings.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../server/services/search/localEmbeddings.ts")
      >();
    return {
      ...actual,
      isSearchEmbeddingReady: () => true,
      embedText: async (text: string): Promise<Float32Array | null> =>
        recorded.byText.get(text) ?? null,
    };
  },
);

import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import {
  rerankModel,
  setPairScorer,
} from "../../server/services/search/crossEncoder.ts";
import {
  CHANNELS,
  EVAL_DIMENSION,
  loadBaseline,
  loadFixture,
  loadRerankScores,
  measure,
  replayScorer,
  seedCorpus,
  seedVectors,
  type Baseline,
  type Measurement,
  type RerankScores,
} from "./harness.ts";

/**
 * Smaller than one query.
 *
 * Fifty queries make each one worth 0.02 of the total recall, and the ten in
 * a kind make each one worth 0.1 of that kind's. A tolerance under both means
 * no query can change its answer without this failing, while still absorbing
 * the last-digit float drift that a different CPU could produce in the
 * distance arithmetic.
 */
const TOLERANCE = 0.01;

let baseline: Baseline;
let measurement: Measurement;
let seededContacts: number;
let storedVectors: number;
let rerankScores: RerankScores;
/** Cross-encoder pairs the gate asked for and the recording does not hold. */
const missingPairs: string[] = [];

beforeAll(async () => {
  baseline = loadBaseline();
  const fixture = loadFixture();

  expect(fixture.manifest.dimension).toBe(EVAL_DIMENSION);

  const scope = scopeForOwnerId(ensureLocalOwner());
  const { idByKey } = await seedCorpus(scope, fixture.contacts);

  seedVectors(fixture.contacts, fixture.contactVectors, idByKey);
  fixture.queries.forEach((query, i) => {
    recorded.byText.set(query.q, fixture.queryVectors[i]);
  });

  // The cross-encoder answers from the recording. A replayed score is
  // instant, and the budget is lifted so a slow machine cannot drop one and
  // turn a timing into a ranking change.
  rerankScores = loadRerankScores();
  process.env.SEARCH_RERANK_BUDGET_MS = "60000";
  setPairScorer(replayScorer(rerankScores, missingPairs));

  seededContacts = (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ?")
      .get(scope.ownerId) as { n: number }
  ).n;
  storedVectors = (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM search_embeddings WHERE ownerId = ?")
      .get(scope.ownerId) as { n: number }
  ).n;

  measurement = await measure(scope, fixture.queries, idByKey);
}, 120_000);

afterAll(() => {
  setPairScorer(null);
  delete process.env.SEARCH_RERANK_BUDGET_MS;
});

describe("search quality gate", () => {
  // Everything below averages over what it was given, and an average over
  // nothing is a pass. A corpus that failed to load, an index that was never
  // built, or a vector store nobody wrote to would each produce a clean sweep
  // of zeros that the tolerance check would then have to catch by accident.
  // These four assertions are what stop that.
  describe("the corpus is really there", () => {
    it("seeded every contact the baseline was recorded against", () => {
      expect(seededContacts).toBe(baseline.corpus.contacts);
    });

    it("stored one search vector per contact", () => {
      expect(storedVectors).toBe(baseline.corpus.contacts);
    });

    it("scored every query", () => {
      for (const channel of CHANNELS) {
        expect(measurement.perQuery[channel]).toHaveLength(
          baseline.corpus.queries,
        );
      }
    });

    it("found something for at least one query in every channel", () => {
      for (const channel of CHANNELS) {
        const hits = measurement.perQuery[channel].filter(
          (r) => r.firstHitRank > 0,
        );
        expect(hits.length).toBeGreaterThan(0);
      }
    });

    // The `reranked` channel is only as real as its recording. A pair the
    // recorder never scored leaves that question in its fused order, which
    // would pass as "the cross-encoder changed nothing".
    it("replayed every cross-encoder pair from the recording", () => {
      expect(
        missingPairs,
        "The cross-encoder read pairs the recording does not hold. Run `npm run eval:record` and commit the fixture.",
      ).toEqual([]);
      expect(rerankScores.model).toBe(rerankModel());
      expect(rerankScores.pairs).toBeGreaterThan(0);
    });
  });

  describe.each(CHANNELS)("%s", (channel) => {
    it("holds its recall at 10", () => {
      const measured = measurement.channels[channel].recallAt10;
      const expected = baseline.channels[channel].recallAt10;
      expect(
        Math.abs(measured - expected),
        `${channel} recall@10 moved from ${expected} to ${measured}. ` +
          `Run \`npm run eval:record\` and commit the baseline if the change was intended.`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });

    it("holds its mean reciprocal rank", () => {
      const measured = measurement.channels[channel].mrr;
      const expected = baseline.channels[channel].mrr;
      expect(
        Math.abs(measured - expected),
        `${channel} MRR moved from ${expected} to ${measured}. ` +
          `Run \`npm run eval:record\` and commit the baseline if the change was intended.`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });

    // Per kind as well as in total, because the total hides a trade. A change
    // that wins two typo queries and loses two company queries moves the
    // total by nothing at all.
    it("holds every kind of query", () => {
      const moved: string[] = [];
      for (const [kind, expected] of Object.entries(baseline.byKind[channel])) {
        const measured = measurement.byKind[channel][kind];
        if (!measured) {
          moved.push(`${kind}: gone from the results entirely`);
          continue;
        }
        if (Math.abs(measured.recallAt10 - expected.recallAt10) > TOLERANCE) {
          moved.push(
            `${kind} recall@10: ${expected.recallAt10} → ${measured.recallAt10}`,
          );
        }
        if (Math.abs(measured.mrr - expected.mrr) > TOLERANCE) {
          moved.push(`${kind} MRR: ${expected.mrr} → ${measured.mrr}`);
        }
      }
      expect(
        moved,
        `${channel} ranking changed for ${moved.length} measure(s). ` +
          `Run \`npm run eval:record\` and commit the baseline if the change was intended.`,
      ).toEqual([]);
    });
  });
});
