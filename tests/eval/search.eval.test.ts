// Search quality gate: 300 contacts, 79 queries, five rankings, two numbers
// each, compared with a committed baseline.
//
// WHEN THIS FAILS, a change moved ranking, on purpose or not. If on purpose,
// run `npm run eval:record` and commit the baseline diff with the change. If
// not, the numbers say which kind of query lost ground. The gate fails on an
// improvement too, so ranking cannot drift up on one kind and down on another
// while the total passes.
//
// WHAT IS REAL: the database, FTS5 and its triggers, the BM25 weights, the
// int8 vec0 store and its scale, the KNN, the rank fusion, and the
// cross-encoder stage's budget, cut and reorder. The embeddings and the
// cross-encoder scores are recorded by `scripts/record-search-eval.ts`, so
// this needs no model and no network.
//
// WHAT IT CATCHES, by breaking the code on purpose. Each line names the
// channels that fail. A mutation that changes a candidate list also asks for
// pairs the recording does not hold, so all but the name weight fail the
// replay check too.
//
//   the BM25 weight string shifted one column      lexical, fused, hybrid
//   the `broad` OR fallback removed from retrieval fused, hybrid, reranked
//   the name weight dropped from 10 to 1           lexical
//   RRF_K changed from 15 to 60                    fused
//   the vector channel limit cut from 100 to 10    fused
//   the address weight raised from 0.5 to 3        all five
//   the address weight dropped from 0.5 to 0       all but sidebar
//   the address text left out of the index         all five, and replay
//
// RRF_K and the vector limit move the fused list only. The hybrid and reranked
// answers stay inside the tolerance, so neither changes what a person sees.
//
// An address weight of 0 still matches the column and scores it 0, so a place
// only one address names is still found first. q74 falls, where six contacts
// share the city and only the address breaks the tie. As the weight rises,
// the address collisions fail: Changi at 1, Seville at 2.5, Danube at 5,
// Fleet at 9, and Ferreira holds at 12. From 0.25 to 0.9 nothing moves.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  /** Query text to its recorded vector. Filled before the first search. */
  byText: new Map<string, Float32Array>(),
}));

// `embedText` is the one place a model would be needed, and
// `isSearchEmbeddingReady` is its gate. The rest of the module stays real,
// because the KNN is under test.
vi.mock(
  "../../server/services/search/vectorIndex.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../server/services/search/vectorIndex.ts")
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
 * Smaller than one query. A kind holds four to ten queries, so each is worth
 * at least 0.1 of its kind's recall. No query can enter or leave the first
 * ten without failing, and the last-digit float drift of another CPU passes.
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
  // A changed fixture, an unbuilt index or an empty vector store would move
  // the numbers for a reason they cannot name. These assertions name it.
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

  // One test per channel, over the total and every kind of query. The total
  // alone hides a trade (two typo queries won, two company queries lost), and
  // it is the number people quote, so a failure names both.
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
