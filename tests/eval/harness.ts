// =============================================================================
// Search evaluation harness — shared by the gate and by the recorder
// =============================================================================
// `tests/eval/search.eval.test.ts` asserts against a committed baseline and
// `scripts/record-search-eval.ts` writes that baseline. Both call `measure()`
// here, so the numbers in the baseline file and the numbers the gate computes
// come from one piece of code. A harness the recorder did not share would
// drift, and the first sign of the drift would be a failing gate nobody could
// explain.
//
// What the two callers do differently is where the query vector comes from.
// The recorder loads the real model. The test replaces `embedText` with a
// lookup into the recorded fixture. Everything else — the corpus, the FTS
// index, the vector store, the fusion — is the real thing in both.
// =============================================================================

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { searchService } from "../../server/services/searchService.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";
import { hybridRetrieval } from "../../server/services/search/hybridRetrieval.ts";
import { upsertSearchEmbeddings } from "../../server/services/search/localEmbeddings.ts";
import type { PairScorer } from "../../server/services/search/crossEncoder.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import { seedWithStableIds, splitVectors, type SeededIds } from "./seeding.ts";
import type {
  EvalContact,
  EvalQuery,
  QueryKind,
} from "../../scripts/search-eval/corpus.ts";

export type { EvalContact, EvalQuery, QueryKind };

/** The five rankings this eval scores. */
export type Channel = "sidebar" | "lexical" | "fused" | "hybrid" | "reranked";

export const CHANNELS: Channel[] = [
  "sidebar",
  "lexical",
  "fused",
  "hybrid",
  "reranked",
];

/** 384, the width of the built-in model. Asserted against the fixture. */
export const EVAL_DIMENSION = 384;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(HERE, "../fixtures/search-eval");
export const BASELINE_PATH = path.resolve(HERE, "search.baseline.json");
export const RERANK_SCORES_PATH = path.join(FIXTURE_DIR, "rerank-scores.json");

// ---------------------------------------------------------------------------
// The fixture on disk
// ---------------------------------------------------------------------------

export interface VectorManifest {
  model: string;
  dimension: number;
  contacts: number;
  queries: number;
  recordedAt: string;
}

export interface Fixture {
  contacts: EvalContact[];
  queries: EvalQuery[];
  manifest: VectorManifest;
  /** One vector per contact, in `contacts` order. */
  contactVectors: Float32Array[];
  /** One vector per query, in `queries` order. */
  queryVectors: Float32Array[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as T;
}

/** Read the committed corpus, queries and vectors. */
export function loadFixture(): Fixture {
  const contacts = readJson<EvalContact[]>("contacts.json");
  const queries = readJson<EvalQuery[]>("queries.json");
  const manifest = readJson<VectorManifest>("vectors.json");
  const buf = fs.readFileSync(path.join(FIXTURE_DIR, "vectors.bin"));

  const expectedBytes =
    (manifest.contacts + manifest.queries) * manifest.dimension * 4;
  if (buf.byteLength !== expectedBytes) {
    throw new Error(
      `vectors.bin is ${buf.byteLength} bytes, expected ${expectedBytes} for ` +
        `${manifest.contacts} contacts + ${manifest.queries} queries at ${manifest.dimension} dimensions`,
    );
  }
  if (
    manifest.contacts !== contacts.length ||
    manifest.queries !== queries.length
  ) {
    throw new Error(
      `vectors.json describes ${manifest.contacts} contacts and ${manifest.queries} queries, ` +
        `but the fixture holds ${contacts.length} and ${queries.length}. Re-record.`,
    );
  }

  const contactVectors = splitVectors(
    buf,
    contacts.length,
    manifest.dimension,
    0,
  );
  const queryVectors = splitVectors(
    buf,
    queries.length,
    manifest.dimension,
    contacts.length,
  );

  // The model returns L2-normalized vectors, so every row sums to one. A row
  // that does not means the file was written on a big-endian machine, or
  // truncated, or is not vectors at all — and each of those would otherwise
  // present as a mysteriously low recall rather than as a broken fixture.
  const norm = contactVectors[0].reduce((sum, v) => sum + v * v, 0);
  if (!(Math.abs(norm - 1) < 0.01)) {
    throw new Error(
      `The first recorded vector has norm ${norm.toFixed(4)}, not 1. vectors.bin is unreadable on this machine.`,
    );
  }

  return { contacts, queries, manifest, contactVectors, queryVectors };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Write the corpus into a real database under one owner, with the ids the
 * baseline was recorded against. See `seedWithStableIds`.
 */
export function seedCorpus(
  scope: Scope,
  contacts: EvalContact[],
): Promise<SeededIds> {
  return seedWithStableIds(scope, "contrack-search-eval", contacts, (c) => ({
    name: c.name,
    firstName: c.firstName,
    lastName: c.lastName,
    company: c.company,
    role: c.role,
    location: c.location,
    industry: c.industry,
    headline: c.headline,
    about: c.about,
    tags: c.tags,
    interests: c.interests,
    emails: c.emails ?? [],
    phones: c.phones ?? [],
    addresses: c.addresses ?? [],
  }));
}

/**
 * Write the corpus vectors the way the product writes a batch.
 *
 * One call, so the int8 scale comes from every vector of the corpus, the
 * scale the boot migration would compute from the same vectors. The gate and
 * the recorder both seed through here, so both search the same bytes.
 */
export function seedVectors(
  contacts: EvalContact[],
  vectors: Float32Array[],
  idByKey: Map<string, string>,
): void {
  upsertSearchEmbeddings(
    contacts.map((contact, i) => ({
      contactId: idByKey.get(contact.key)!,
      embedding: vectors[i],
    })),
  );
}

// ---------------------------------------------------------------------------
// Recorded cross-encoder scores
// ---------------------------------------------------------------------------

/** The scores the recorder saw, by question and by profile text hash. */
export interface RerankScores {
  model: string;
  recordedAt: string;
  pairs: number;
  scores: Record<string, Record<string, number>>;
}

/** A profile text as a short key. The text itself is long and repeats. */
export function docKey(doc: string): string {
  return crypto.createHash("sha256").update(doc).digest("hex").slice(0, 16);
}

export function loadRerankScores(): RerankScores {
  return JSON.parse(
    fs.readFileSync(RERANK_SCORES_PATH, "utf8"),
  ) as RerankScores;
}

/**
 * A scorer that answers from the recorded scores.
 *
 * A pair the recorder never saw is a failure, collected in `missing`: the
 * profile text or the candidates changed, and the fixture must be recorded
 * again. It still answers, with nothing reordered, so the rest of the gate
 * runs and the failure names every missing pair at once.
 */
export function replayScorer(
  recorded: RerankScores,
  missing: string[],
): PairScorer {
  return async ({ model, query, docs }) => {
    if (model !== recorded.model) {
      missing.push(`model ${model}, recorded ${recorded.model}`);
      throw new Error("re-record the cross-encoder scores");
    }
    const byDoc = recorded.scores[query] ?? {};
    const scores = docs.map((doc) => byDoc[docKey(doc)]);
    if (scores.some((score) => score === undefined)) {
      missing.push(
        `"${query}": ${scores.filter((x) => x === undefined).length} pair(s)`,
      );
      throw new Error("re-record the cross-encoder scores");
    }
    return scores as number[];
  };
}

/** A scorer that records what `score` returns, for the recorder. */
export function recordingScorer(
  score: PairScorer,
  into: Record<string, Record<string, number>>,
): PairScorer {
  return async (request, signal) => {
    const scores = await score(request, signal);
    const byDoc = (into[request.query] ??= {});
    request.docs.forEach((doc, i) => (byDoc[docKey(doc)] = scores[i]));
    return scores;
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface ChannelScore {
  recallAt10: number;
  mrr: number;
}

export interface QueryResult {
  id: string;
  kind: QueryKind;
  /** Rank of the first expected contact, 1-based. 0 when none appeared. */
  firstHitRank: number;
  /** Expected contacts found in the top ten, over expected contacts. */
  recallAt10: number;
}

export interface Measurement {
  channels: Record<Channel, ChannelScore>;
  byKind: Record<Channel, Record<string, ChannelScore>>;
  perQuery: Record<Channel, QueryResult[]>;
}

const K = 10;

function score(
  ranked: string[],
  expected: Set<string>,
): QueryResult["recallAt10"] {
  const top = ranked.slice(0, K);
  let found = 0;
  for (const id of top) if (expected.has(id)) found++;
  return found / expected.size;
}

function firstHit(ranked: string[], expected: Set<string>): number {
  for (let i = 0; i < ranked.length && i < K; i++) {
    if (expected.has(ranked[i])) return i + 1;
  }
  return 0;
}

/** recall@10 and MRR of rankings, each against its expected contacts. */
export function scoreRankings(
  rows: { ranked: string[]; expected: Set<string> }[],
): ChannelScore {
  return aggregate(
    rows.map(({ ranked, expected }, i) => ({
      id: String(i),
      kind: "company-role",
      firstHitRank: firstHit(ranked, expected),
      recallAt10: score(ranked, expected),
    })),
  );
}

function aggregate(results: QueryResult[]): ChannelScore {
  if (results.length === 0) {
    // An empty result set averages to zero, not to one. This is the trap an
    // earlier audit script in this repository fell into: it measured a page
    // with nothing on it and reported a clean pass.
    throw new Error("Nothing was measured. The eval scored zero queries.");
  }
  const recall = results.reduce((s, r) => s + r.recallAt10, 0) / results.length;
  const mrr =
    results.reduce((s, r) => s + (r.firstHitRank ? 1 / r.firstHitRank : 0), 0) /
    results.length;
  return { recallAt10: round(recall), mrr: round(mrr) };
}

/** Four decimal places. Enough to see a single query move, short enough to diff. */
function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Options for one measurement. */
export interface MeasureOptions {
  /** The fusion constant. The code's `RRF_K` when unset. The benchmark's k sweep sets it. */
  rrfK?: number;
}

/**
 * Run every query through all five rankings and score them.
 *
 * `sidebar` is `searchService.searchFts`, the quick search box. It joins its
 * tokens with AND and has no fallback, which is why it scores nothing at all
 * on a sentence: one word the corpus does not carry empties the result. That
 * is the widget working as designed, and recording it means a change to it
 * cannot pass unnoticed.
 *
 * `lexical` is the same FTS5 statement the hybrid retrieval uses, with the OR
 * fallback switched on. This is the number the BM25 column weights move, and
 * it is the reason this eval exists: `WEIGHTS` in `search/lexical.ts` is one
 * string of eleven numbers that anybody can edit, and nothing else in the
 * suite would notice a change.
 *
 * `fused` is `hybridRetrieval`. With no AI provider configured
 * `parseSearchQuery` returns null, so there is no query plan, no hard
 * pre-filter and no trait boost: what is measured is the keyword and vector
 * channels fused by weighted reciprocal rank, and nothing that needs a
 * network. This is the number the fusion weights and `k` move.
 *
 * `hybrid` is what Ask Contrack answers without a model: a name, an email or
 * a phone number from strict keyword search, a question that names a known
 * place, company or industry inside those facets, and everything else as
 * the fused list. It is what a person sees before the model answers, and
 * what they keep when it fails. It leaves the cross-encoder out.
 *
 * `reranked` is `hybrid` with the cross-encoder on, which reorders the top of
 * the fused list. The gate replays recorded scores for it, so it needs no
 * model. When no cross-encoder is ready, it equals `hybrid`.
 */
export async function measure(
  scope: Scope,
  queries: EvalQuery[],
  idByKey: Map<string, string>,
  options: MeasureOptions = {},
): Promise<Measurement> {
  const results: Record<Channel, QueryResult[]> = {
    sidebar: [],
    lexical: [],
    fused: [],
    hybrid: [],
    reranked: [],
  };

  for (const query of queries) {
    const expected = new Set(
      query.expect.map((key) => {
        const id = idByKey.get(key);
        if (!id)
          throw new Error(
            `Query ${query.id} expects "${key}", which was not seeded`,
          );
        return id;
      }),
    );

    const retrieval = await hybridRetrieval(
      scope,
      query.q,
      `eval-${query.id}`,
      undefined,
      { rrfK: options.rrfK },
    );
    const answer = await searchService.semanticSearch(
      scope,
      query.q,
      `eval-${query.id}`,
      undefined,
      { aiAllowed: false, rrfK: options.rrfK, crossEncoder: false },
    );
    const reranked = await searchService.semanticSearch(
      scope,
      query.q,
      `eval-${query.id}`,
      undefined,
      { aiAllowed: false, rrfK: options.rrfK },
    );
    const ranked: Record<Channel, string[]> = {
      sidebar: searchService
        .searchFts(scope, query.q)
        .map((row) => String(row.id)),
      lexical: lexicalSearch(scope, query.q, 20, null, true).map(
        (row) => row.contactId,
      ),
      fused: retrieval.candidates.map((c) => c.contactId),
      hybrid: answer.matches.map((match) => match.id),
      reranked: reranked.matches.map((match) => match.id),
    };

    for (const channel of CHANNELS) {
      results[channel].push({
        id: query.id,
        kind: query.kind,
        firstHitRank: firstHit(ranked[channel], expected),
        recallAt10: score(ranked[channel], expected),
      });
    }
  }

  const byKind = (rows: QueryResult[]): Record<string, ChannelScore> => {
    const kinds = [...new Set(rows.map((r) => r.kind))].sort();
    return Object.fromEntries(
      kinds.map((kind) => [
        kind,
        aggregate(rows.filter((r) => r.kind === kind)),
      ]),
    );
  };

  const per = <T>(fn: (rows: QueryResult[]) => T): Record<Channel, T> =>
    Object.fromEntries(CHANNELS.map((c) => [c, fn(results[c])])) as Record<
      Channel,
      T
    >;

  return {
    channels: per(aggregate),
    byKind: per(byKind),
    perQuery: results,
  };
}

// ---------------------------------------------------------------------------
// The baseline file
// ---------------------------------------------------------------------------

export interface Baseline {
  recordedAt: string;
  model: string;
  corpus: { contacts: number; queries: number };
  channels: Record<Channel, ChannelScore>;
  byKind: Record<Channel, Record<string, ChannelScore>>;
}

export function loadBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}
