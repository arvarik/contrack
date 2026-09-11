// =============================================================================
// Dedupe evaluation harness — shared by the gate and by the recorder
// =============================================================================
// `tests/eval/dedupe.eval.test.ts` asserts against a committed baseline and
// `scripts/record-dedupe-eval.ts` writes that baseline. Both call `measure()`
// here, so the numbers in the file and the numbers the gate computes come out
// of one piece of code.
//
// What it measures is the engine, not a matcher. The corpus goes into a real
// database through the real create path, and the passes run against it the
// way a scan runs them. The only thing held back is the two non-deterministic
// inputs: the AI verification step and the provider embeddings. Both are off,
// and `assertDeterministicEnvironment` fails the run rather than quietly
// measuring something else if either turns up configured.
// =============================================================================

import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { ai } from "../../server/ai/index.ts";
import { contactService } from "../../server/services/contactService.ts";
import { buildPassContext } from "../../server/services/dedupe/context.ts";
import {
  runDeterministicPass,
  runFunnelPass,
} from "../../server/services/dedupe/passes.ts";
import {
  buildIncrementalCorpus,
  findIncrementalPairs,
  normalizeTarget,
} from "../../server/services/dedupe/incremental.ts";
import {
  generateBlockKeys,
  normalizeContact,
} from "../../server/services/dedupe/normalization.ts";
import { isEmbeddingAvailable } from "../../server/services/dedupe/embeddings.ts";
import { DEFAULT_AUTO_MERGE_THRESHOLD } from "../../server/services/dedupe/engine.ts";
import {
  THRESHOLD_AI,
  THRESHOLD_AUTO,
} from "../../server/services/dedupe/scoring.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import type { RawPair } from "../../server/services/dedupe/types.ts";
import {
  buildCorpus,
  pairId,
  type Corpus,
  type EvalContact,
} from "../../scripts/dedupe-eval/corpus.ts";

export { buildCorpus, pairId };
export type { Corpus, EvalContact };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = path.resolve(HERE, "dedupe.baseline.json");

/**
 * The three numbers that decide what happens to a scored pair.
 *
 * Read from the engine rather than restated here, which was the first
 * version and did not work: a harness with its own copy of 0.93 measures
 * "pairs above 0.93" whether or not the engine still uses that number, so
 * lowering `THRESHOLD_AUTO` to 0.90 moved no metric and the gate passed. The
 * fixture is supposed to be the regression suite for exactly that change.
 *
 * They are recorded in the baseline as well as used, so moving one fails by
 * name instead of showing up as an unexplained shift in precision.
 */
export const THRESHOLDS = {
  /** Above this a pair is claimed without asking a model. */
  auto: THRESHOLD_AUTO,
  /** Below this a pair is dropped rather than verified. */
  ai: THRESHOLD_AI,
  /** Above this a pair is merged with nobody asked. */
  autoMerge: DEFAULT_AUTO_MERGE_THRESHOLD,
} as const;

/**
 * The cut the "at auto-merge" half of every score uses.
 *
 * Precision over every produced pair says how much of somebody's review queue
 * is noise. Precision over the pairs at or above this says how often the
 * engine merges two people who are not the same person, with nobody asked.
 * The second is the one that loses data.
 */
export const AUTO_MERGE_THRESHOLD = THRESHOLDS.autoMerge;

/** The four routes a pair can be produced by. */
export type PassName = "deterministic" | "funnel" | "combined" | "incremental";

export const PASSES: PassName[] = [
  "deterministic",
  "funnel",
  "combined",
  "incremental",
];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Refuse to measure when the run would not be reproducible.
 *
 * A developer with a provider key in their environment would otherwise get
 * different numbers from CI, and the first sign of it would be a gate that
 * fails on their machine and passes on everybody else's.
 */
export function assertDeterministicEnvironment(): void {
  if (ai.isConfigured) {
    throw new Error(
      "The dedupe eval needs AI off. A provider is configured, so the funnel " +
        "would send its ambiguous pairs to a model and the numbers would not " +
        "be reproducible. Clear the provider keys for this run.",
    );
  }
  if (isEmbeddingAvailable()) {
    throw new Error(
      "The dedupe eval needs the dedupe embedding store off. Provider " +
        "embeddings are available, so the KNN would add candidates that no " +
        "committed fixture pins.",
    );
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * A contact id that is the same on every run.
 *
 * Several matchers break ties on the contact id, and the deterministic pass
 * emits `idA < idB` from a SQL self-join, so a random UUID changes which of
 * two records is the left side of a pair. That does not move precision, but
 * it does move which id a failure message names, and a gate whose failure
 * text changes between runs is a gate nobody trusts.
 */
function deterministicId(index: number): string {
  const h = crypto
    .createHash("sha256")
    .update(`contrack-dedupe-eval:${index}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface SeededCorpus {
  corpus: Corpus;
  idByKey: Map<string, string>;
  keyById: Map<string, string>;
}

/**
 * Write the corpus into a real database under one owner.
 *
 * Through `bulkCreateContacts`, not through INSERT: the child rows, the
 * source platform and the phonetic hash all come from the create path, and a
 * hand-written row would normalize differently from a row the product wrote.
 */
export async function seedCorpus(
  scope: Scope,
  corpus: Corpus,
): Promise<SeededCorpus> {
  const realRandomUUID = crypto.randomUUID;
  let issued = 0;
  (crypto as { randomUUID: () => string }).randomUUID = () =>
    deterministicId(issued++);

  let createdIds: string[];
  try {
    ({ createdIds } = await contactService.bulkCreateContacts(
      scope,
      corpus.contacts.map((c) => ({
        name: c.name,
        company: c.company,
        role: c.role,
        location: c.location,
        emails: c.emails,
        phones: c.phones,
        // Both, and they are not the same thing. `sources` writes the
        // `contact_sources` rows the cross-source matcher reads;
        // `_sourcePlatform` stamps provenance onto each email and phone row.
        // Passing only the second seeded a corpus with no sources at all, so
        // the cross-source category scored against nothing and the
        // `isCrossSource` signal was dead for every pair.
        sources: c.sources,
        _sourcePlatform: c.sources[0] ?? "manual",
      })),
    ));
  } finally {
    (crypto as { randomUUID: typeof realRandomUUID }).randomUUID =
      realRandomUUID;
  }

  if (createdIds.length !== corpus.contacts.length) {
    throw new Error(
      `Seeded ${createdIds.length} of ${corpus.contacts.length} contacts. ` +
        `The eval cannot score a partial corpus.`,
    );
  }

  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();
  corpus.contacts.forEach((c, i) => {
    idByKey.set(c.key, createdIds[i]);
    keyById.set(createdIds[i], c.key);
  });
  return { corpus, idByKey, keyById };
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

/** A fixture contact in the shape the normalizer takes. No tags, no interests. */
export function normalizeEvalContact(contact: EvalContact) {
  return normalizeContact(
    {
      id: contact.key,
      name: contact.name,
      company: contact.company,
      role: contact.role,
      location: contact.location,
    },
    contact.emails.map((email) => ({ email })),
    contact.phones.map((phone) => ({ phone })),
    contact.sources,
    [],
    [],
  );
}

/**
 * The ways the engine could reach this pair at all.
 *
 * Recall counts a pair the engine did not produce against it, which is only a
 * fair count when the engine had some route to it. Every labelled duplicate
 * has to share a blocking key, an exact normalized name (which is D3's route)
 * or a surname (which is D5's). A labelled pair with none of those would
 * lower recall for ever and name no bug.
 *
 * Lives here rather than in the corpus file because reaching
 * `generateBlockKeys` means importing the dedupe engine, and the corpus is
 * plain data that a script can read without opening a database.
 */
export function reachRoutes(a: EvalContact, b: EvalContact): string[] {
  const na = normalizeEvalContact(a);
  const nb = normalizeEvalContact(b);
  const routes: string[] = [];

  if (na.nameNorm.length > 0 && na.nameNorm === nb.nameNorm) {
    routes.push("exact-name");
  }
  if (na.lastNameNorm.length >= 2 && na.lastNameNorm === nb.lastNameNorm) {
    routes.push("surname");
  }
  const keysB = new Set(generateBlockKeys(nb));
  for (const key of generateBlockKeys(na)) {
    if (keysB.has(key)) routes.push(`block:${key.split(":")[0]}`);
  }
  return [...new Set(routes)];
}

// ---------------------------------------------------------------------------
// Running the passes
// ---------------------------------------------------------------------------

/**
 * Run one pass over the seeded corpus and return the pairs it produced.
 *
 * Each pass gets its own `buildPassContext`. In production the deterministic
 * pass and the funnel share one, and the shared `seenPairs` is how the funnel
 * knows not to re-score what the deterministic pass already claimed. Scoring
 * them apart is deliberate: it answers "what can this pass find", which is
 * what a per-pass number is for. `combined` is the production arrangement and
 * is the number that describes a real scan.
 */
export async function runPass(
  scope: Scope,
  pass: PassName,
  rid = "eval",
): Promise<RawPair[]> {
  if (pass === "incremental") {
    // The import path. Every contact is checked against the corpus once, with
    // one shared `seen` set, which is what `runImportScan` does.
    const corpus = buildIncrementalCorpus(scope, rid);
    const seen = new Set<string>();
    const pairs: RawPair[] = [];
    for (const normalized of corpus.normalized) {
      const target = normalizeTarget(corpus, normalized.id);
      if (!target) continue;
      pairs.push(...findIncrementalPairs(corpus, normalized.id, target, seen));
    }
    return pairs;
  }

  const ctx = buildPassContext(scope, rid);
  if (pass === "deterministic") return runDeterministicPass(ctx);
  if (pass === "funnel") return runFunnelPass(ctx, undefined, false);

  const deterministic = runDeterministicPass(ctx);
  const funnel = await runFunnelPass(ctx, undefined, false);
  return [...deterministic, ...funnel];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface PassScore {
  /** Pairs the pass produced at any confidence. */
  produced: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  /** The same three counts over pairs at or above the auto-merge threshold. */
  autoProduced: number;
  autoTruePositives: number;
  autoFalsePositives: number;
  autoPrecision: number;
  /**
   * Mean confidence of the pairs the pass produced.
   *
   * Here because precision and recall are both computed over the SET of pairs
   * and a threshold change can move every confidence without adding or
   * removing one pair. Lowering `THRESHOLD_AUTO` from 0.93 to 0.90 does
   * exactly that: pairs that used to be emitted at `score * 0.7` are emitted
   * at `score`. The set is identical, so precision and recall did not move,
   * and the gate passed a change it exists to catch.
   */
  meanConfidence: number;
}

export interface PassMeasurement {
  score: PassScore;
  /** Recall per duplicate kind, so a regression names the kind it broke. */
  recallByKind: Record<string, number>;
  /** Hard negatives the pass produced anyway, per kind. Lower is better. */
  negativesMatchedByKind: Record<string, number>;
}

export type Measurement = Record<PassName, PassMeasurement>;

/** Four decimal places. Enough to see one pair move, short enough to diff. */
function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Score one pass's output against the labels.
 *
 * The ground truth is closed: every pair the pass produced that is not a
 * labelled duplicate is a false positive, whether it is a named hard negative
 * or two contacts nobody thought about. `validateCorpus` is what makes that
 * fair — it refuses a corpus in which two records of one person could go
 * unlabelled.
 */
export function scorePass(
  pairs: RawPair[],
  seeded: SeededCorpus,
): PassMeasurement {
  const { corpus, keyById } = seeded;

  const truth = new Map<string, string>();
  for (const pair of corpus.duplicates) {
    truth.set(pairId(pair.a, pair.b), pair.kind);
  }
  const negativeKind = new Map<string, string>();
  for (const pair of corpus.negatives) {
    negativeKind.set(pairId(pair.a, pair.b), pair.kind);
  }

  // Best confidence per pair. A pass can produce the same pair twice —
  // `combined` runs two passes with separate contexts — and counting it twice
  // would make precision depend on how the passes were arranged.
  const produced = new Map<string, number>();
  for (const pair of pairs) {
    const keyA = keyById.get(pair.idA);
    const keyB = keyById.get(pair.idB);
    if (!keyA || !keyB) {
      throw new Error(
        `The engine produced a pair naming a contact outside the corpus ` +
          `(${pair.idA} ↔ ${pair.idB}). The database was not clean.`,
      );
    }
    const id = pairId(keyA, keyB);
    produced.set(id, Math.max(produced.get(id) ?? 0, pair.confidence));
  }

  let truePositives = 0;
  let falsePositives = 0;
  let autoTruePositives = 0;
  let autoFalsePositives = 0;
  const negativesMatchedByKind: Record<string, number> = {};
  for (const kind of new Set(corpus.negatives.map((n) => n.kind))) {
    negativesMatchedByKind[kind] = 0;
  }

  for (const [id, confidence] of produced) {
    const isAuto = confidence >= AUTO_MERGE_THRESHOLD;
    if (truth.has(id)) {
      truePositives++;
      if (isAuto) autoTruePositives++;
    } else {
      falsePositives++;
      if (isAuto) autoFalsePositives++;
      const kind = negativeKind.get(id);
      if (kind) negativesMatchedByKind[kind]++;
    }
  }

  const foundByKind: Record<string, number> = {};
  const totalByKind: Record<string, number> = {};
  for (const pair of corpus.duplicates) {
    totalByKind[pair.kind] = (totalByKind[pair.kind] ?? 0) + 1;
    if (produced.has(pairId(pair.a, pair.b))) {
      foundByKind[pair.kind] = (foundByKind[pair.kind] ?? 0) + 1;
    }
  }
  const recallByKind: Record<string, number> = {};
  for (const kind of Object.keys(totalByKind).sort()) {
    recallByKind[kind] = round((foundByKind[kind] ?? 0) / totalByKind[kind]);
  }

  const falseNegatives = corpus.duplicates.length - truePositives;
  const precision =
    truePositives + falsePositives === 0
      ? 0
      : truePositives / (truePositives + falsePositives);
  const recall = truePositives / corpus.duplicates.length;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  const autoProduced = autoTruePositives + autoFalsePositives;
  const meanConfidence =
    produced.size === 0
      ? 0
      : [...produced.values()].reduce((sum, c) => sum + c, 0) / produced.size;

  return {
    score: {
      produced: produced.size,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: round(precision),
      recall: round(recall),
      f1: round(f1),
      autoProduced,
      autoTruePositives,
      autoFalsePositives,
      autoPrecision:
        autoProduced === 0 ? 0 : round(autoTruePositives / autoProduced),
      meanConfidence: round(meanConfidence),
    },
    recallByKind,
    negativesMatchedByKind,
  };
}

/** Run all four passes over a seeded corpus and score each one. */
export async function measure(
  scope: Scope,
  seeded: SeededCorpus,
): Promise<Measurement> {
  assertDeterministicEnvironment();
  const out = {} as Measurement;
  for (const pass of PASSES) {
    out[pass] = scorePass(await runPass(scope, pass), seeded);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The baseline file
// ---------------------------------------------------------------------------

export interface Baseline {
  recordedAt: string;
  corpus: {
    contacts: number;
    duplicatePairs: number;
    hardNegatives: number;
  };
  thresholds: { auto: number; ai: number; autoMerge: number };
  passes: Measurement;
}
