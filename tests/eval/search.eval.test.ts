// =============================================================================
// Search quality gate
// =============================================================================
// Three hundred contacts, seventy-nine queries, five rankings, two numbers
// each, all compared with a committed baseline.
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
// WHAT IT CATCHES, measured by breaking the code on purpose (2026-09-29).
// Each line names the channels whose test fails. A mutation that changes a
// candidate list also asks the cross-encoder for pairs the recording does
// not hold, so all but the name weight fail the replay check as well.
//
//   the BM25 weight string shifted one column      lexical, fused, hybrid
//   the `broad` OR fallback removed from retrieval fused, hybrid, reranked
//   the name weight dropped from 10 to 1           lexical
//   RRF_K changed from 15 to 60                    fused
//   the vector channel limit cut from 100 to 10    fused
//
// The last two move the fused list and nothing after it. The hybrid and
// reranked answers stay inside the tolerance, which is another way of saying
// neither changes what a person sees. recall@10 and MRR measure the answer,
// not the arithmetic that produced it.
//
// The address weight, measured the same way (2026-09-30):
//
//   the address weight raised from 0.5 to 3        all five
//   the address weight dropped from 0.5 to 0       all but sidebar
//   the address text left out of the index         all five, and replay
//
// A weight of 0 does not take the column out of the index. FTS5 still
// matches it and scores it 0, so a street, a postcode or a town that only one
// address names is still found, and still first. The query that falls is
// q74, where six contacts share the city and only the address can break the
// tie. The address collisions fail in turn as the weight rises past the
// field they share a word with. Of the weights measured, Changi first failed
// at 1, Seville at 2.5, Danube at 5 and Fleet at 9, and Ferreira still held
// at 12. From 0.25 to 0.9 nothing moves: the address is the lightest text
// either way.
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
import { rerankModel, setReranker } from "../../server/ai/reranker.ts";
import {
  CHANNELS,
  EVAL_DIMENSION,
  loadBaseline,
  loadFixture,
  loadRerankScores,
  measure,
  replayReranker,
  seedCorpus,
  seedVectors,
  type Baseline,
  type ChannelScore,
  type Measurement,
  type RerankScores,
} from "./harness.ts";

/**
 * Smaller than one query.
 *
 * A kind holds four to ten queries, so each one is worth at least 0.1 of its
 * kind's recall. A tolerance under that means no query can move into or out
 * of the first ten without this failing, while still absorbing the last-digit
 * float drift that a different CPU could produce in the distance arithmetic.
 */
const TOLERANCE = 0.01;

let baseline: Baseline;
let measurement: Measurement;
let seededContacts: number;
let storedVectors: number;
let fixtureQueries: number;
let rerankScores: RerankScores;
/** Cross-encoder pairs the gate asked for and the recording does not hold. */
const missingPairs: string[] = [];

beforeAll(async () => {
  baseline = loadBaseline();
  const fixture = loadFixture();

  expect(fixture.manifest.dimension).toBe(EVAL_DIMENSION);
  fixtureQueries = fixture.queries.length;

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
  setReranker(replayReranker(rerankScores, missingPairs));

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
  setReranker(null);
  delete process.env.SEARCH_RERANK_BUDGET_MS;
});

describe("search quality gate", () => {
  // Every score below is compared with a baseline recorded against one
  // corpus. A fixture that changed without a new baseline, an index that was
  // never built, or a vector store nobody wrote to would each move the
  // numbers for a reason the numbers cannot name. These assertions name it.
  describe("the corpus is really there", () => {
    it("seeded every contact the baseline was recorded against", () => {
      expect(seededContacts).toBe(baseline.corpus.contacts);
    });

    it("stored one search vector per contact", () => {
      expect(storedVectors).toBe(baseline.corpus.contacts);
    });

    it("holds every query the baseline was recorded against", () => {
      expect(fixtureQueries).toBe(baseline.corpus.queries);
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

  // One test per channel, over the total and over every kind of query. The
  // total alone hides a trade: a change that wins two typo queries and loses
  // two company queries moves it by nothing at all. The kinds alone would be
  // enough, because the total is their weighted mean, but the total is the
  // number people quote, so a failure names it too.
  describe.each(CHANNELS)("%s", (channel) => {
    it("holds its recall at 10 and its MRR, in total and for every kind of query", () => {
      const moved: string[] = [];
      const compare = (
        label: string,
        expected: ChannelScore,
        measured: ChannelScore | undefined,
      ) => {
        if (!measured) {
          moved.push(`${label}: gone from the results entirely`);
          return;
        }
        if (Math.abs(measured.recallAt10 - expected.recallAt10) > TOLERANCE) {
          moved.push(
            `${label} recall@10: ${expected.recallAt10} → ${measured.recallAt10}`,
          );
        }
        if (Math.abs(measured.mrr - expected.mrr) > TOLERANCE) {
          moved.push(`${label} MRR: ${expected.mrr} → ${measured.mrr}`);
        }
      };

      compare(
        "total",
        baseline.channels[channel],
        measurement.channels[channel],
      );
      for (const [kind, expected] of Object.entries(baseline.byKind[channel])) {
        compare(kind, expected, measurement.byKind[channel][kind]);
      }

      expect(
        moved,
        `${channel} ranking changed for ${moved.length} measure(s). ` +
          `Run \`npm run eval:record\` and commit the baseline if the change was intended.`,
      ).toEqual([]);
    });
  });
});
