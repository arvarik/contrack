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
import { contactService } from "../../server/services/contactService.ts";
import { searchService } from "../../server/services/searchService.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";
import { hybridRetrieval } from "../../server/services/search/hybridRetrieval.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import type {
  EvalContact,
  EvalQuery,
  QueryKind,
} from "../../scripts/search-eval/corpus.ts";

export type { EvalContact, EvalQuery, QueryKind };

/** The three rankings this eval scores. */
export type Channel = "sidebar" | "lexical" | "hybrid";

export const CHANNELS: Channel[] = ["sidebar", "lexical", "hybrid"];

/** 384, the width of the built-in model. Asserted against the fixture. */
export const EVAL_DIMENSION = 384;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(HERE, "../fixtures/search-eval");
export const BASELINE_PATH = path.resolve(HERE, "search.baseline.json");

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

/**
 * Split the flat vector file into one array per row.
 *
 * The copy through `slice` is not waste. `readFileSync` hands back a Buffer
 * that borrows a shared pool, and its `byteOffset` is whatever the pool
 * happened to be at, so a Float32Array view over it throws on any offset that
 * is not a multiple of four. The copy also detaches the vectors from the
 * pool, which is what lets the Buffer be collected.
 */
function splitVectors(
  buf: Buffer,
  count: number,
  dimension: number,
  from: number,
): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = (from + i) * dimension * 4;
    const end = start + dimension * 4;
    const bytes = buf.buffer.slice(
      buf.byteOffset + start,
      buf.byteOffset + end,
    );
    out.push(new Float32Array(bytes));
  }
  return out;
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
 * A contact id that is the same on every run.
 *
 * `lexicalSearch` orders by `bm25(...), c.id`, so the contact id is the tie
 * break, and with a random UUID two contacts on the same BM25 score swap
 * places between runs. At the tenth position that moves a contact in and out
 * of recall@10, which would make this gate fail at random and teach everybody
 * to re-run it until it passed.
 *
 * The shape is a valid v4 UUID because that is what the column holds
 * everywhere else. The bytes are a hash of the index, so the corpus is
 * reproducible without being predictable enough to be mistaken for a real id.
 */
function deterministicId(index: number): string {
  const h = crypto
    .createHash("sha256")
    .update(`contrack-search-eval:${index}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Write the corpus into a real database under one owner.
 *
 * Through `bulkCreateContacts`, not through INSERT: the FTS rows come from
 * the triggers on `contacts`, and a hand written row would index differently
 * from a row the product writes. Returns the fixture key of every contact by
 * its generated id, which is what turns a ranked list of ids back into
 * something the queries can be scored against.
 *
 * The id generator is replaced for the duration of the insert, and put back
 * afterwards. The service picks its own ids and there is no argument for one,
 * which is correct for the product and inconvenient exactly here.
 */
export async function seedCorpus(
  scope: Scope,
  contacts: EvalContact[],
): Promise<{ idByKey: Map<string, string>; keyById: Map<string, string> }> {
  const realRandomUUID = crypto.randomUUID;
  let issued = 0;
  (crypto as { randomUUID: () => string }).randomUUID = () =>
    deterministicId(issued++);

  let createdIds: string[];
  try {
    ({ createdIds } = await contactService.bulkCreateContacts(
      scope,
      contacts.map((c) => ({
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
      })),
    ));
  } finally {
    (crypto as { randomUUID: typeof realRandomUUID }).randomUUID =
      realRandomUUID;
  }

  if (createdIds.length !== contacts.length) {
    throw new Error(
      `Seeded ${createdIds.length} of ${contacts.length} contacts. The eval cannot score a partial corpus.`,
    );
  }

  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();
  contacts.forEach((c, i) => {
    idByKey.set(c.key, createdIds[i]);
    keyById.set(createdIds[i], c.key);
  });
  return { idByKey, keyById };
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

/**
 * Run every query through all three rankings and score them.
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
 * `hybrid` is `hybridRetrieval`, what a semantic search actually returns.
 * With no AI provider configured `parseSearchQuery` returns null, so there is
 * no query plan, no hard pre-filter and no trait boost: what is measured is
 * the keyword and vector channels fused by reciprocal rank, and nothing that
 * needs a network.
 */
export async function measure(
  scope: Scope,
  queries: EvalQuery[],
  idByKey: Map<string, string>,
): Promise<Measurement> {
  const results: Record<Channel, QueryResult[]> = {
    sidebar: [],
    lexical: [],
    hybrid: [],
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

    const retrieval = await hybridRetrieval(scope, query.q, `eval-${query.id}`);
    const ranked: Record<Channel, string[]> = {
      sidebar: searchService
        .searchFts(scope, query.q)
        .map((row) => String(row.id)),
      lexical: lexicalSearch(scope, query.q, 20, null, true).map(
        (row) => row.contactId,
      ),
      hybrid: retrieval.candidates.map((c) => c.contactId),
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
