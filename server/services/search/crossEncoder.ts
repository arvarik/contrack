// =============================================================================
// The local cross-encoder
// =============================================================================
// Reorders the top of the local list, the keyword and vector results fused by
// weighted reciprocal rank, with a small cross-encoder on the CPU worker. A
// cross-encoder reads the question and one profile together, so "someone who
// knows about beekeeping" ranks a profile by what it says, not only by which
// words or vectors happen to be close.
//
// It never delays the list. The stage has a budget,
// `SEARCH_RERANK_BUDGET_MS` (25 ms by default). When the scores arrive after
// it, the list keeps its RRF order and the late scores are dropped. A job
// that has not reached the worker yet is cancelled. A worker busy with an
// embedding backfill is the usual reason for a late score.
//
// It reads questions only, the `conceptual` kind. A name, an email, a phone
// number and a quoted phrase are answered by strict keyword search, and a
// short `mixed` query is usually a misspelled name or a prefix. A
// cross-encoder is not typo-tolerant: on the search gate's corpus at 5,000
// contacts it moved "Shivaun Murphey" from 2nd to 9th and the prefix "Thwa"
// from 1st to 4th, while it moved "someone in Barcelona who cooks" from 3rd
// to 1st.
//
// The model loads once, on the worker, when the server starts
// (`initCrossEncoder`). Until it has loaded, or when it cannot load, the
// stage is skipped. `SEARCH_RERANK_MODEL=off` turns it off.
// =============================================================================

import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { cancelJob, isWorkerActive, startJob } from "../../workers/cpuHost.ts";

/**
 * The model when `SEARCH_RERANK_MODEL` is unset.
 *
 * Measured against `Xenova/ms-marco-MiniLM-L-6-v2` with
 * `scripts/benchmark-search.ts --rerank-sweep`. Both lift the golden
 * questions the same, from MRR 0.983 to 0.993 at 5,000 contacts, and only
 * this one fits the budget: 10.5 ms at p95 for 30 candidates, where
 * MiniLM-L-6 needs 30.8 ms for 10.
 */
export const DEFAULT_RERANK_MODEL = "Xenova/ms-marco-TinyBERT-L-2-v2";

/** The budget when `SEARCH_RERANK_BUDGET_MS` is unset, in milliseconds. */
export const DEFAULT_RERANK_BUDGET_MS = 25;

/**
 * How many candidates from the top of the local list the model scores.
 *
 * The whole instant list: no extra retrieval, and well inside the budget.
 * 10, 20, 30 and 50 gave the same answers on the golden questions.
 */
export const RERANK_CANDIDATES = 30;

/** Tokens per (question, profile) pair. The end of a longer profile is cut. */
export const RERANK_MAX_TOKENS = 128;

/**
 * Characters of profile text sent to the worker.
 *
 * The tokenizer cuts at 128 tokens anyway. This only keeps a long headline
 * from crossing the thread boundary for nothing.
 */
const PROFILE_CHARS = 600;

/** The model the settings name, or null when the stage is off. */
export function rerankModel(): string | null {
  const value = process.env.SEARCH_RERANK_MODEL?.trim();
  if (value?.toLowerCase() === "off") return null;
  return value || DEFAULT_RERANK_MODEL;
}

/** The budget the settings name. A value that is not a number is ignored. */
export function rerankBudgetMs(): number {
  const raw = process.env.SEARCH_RERANK_BUDGET_MS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_RERANK_BUDGET_MS;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** One scoring request: a question and one profile text per candidate. */
export interface PairRequest {
  model: string;
  query: string;
  docs: string[];
}

/** Scores in `docs` order. The signal aborts once the scores are too late. */
export type PairScorer = (
  request: PairRequest,
  signal: AbortSignal,
) => Promise<number[]>;

/** Score on the CPU worker. A job still queued when the signal aborts never runs. */
export const scoreOnWorker: PairScorer = async (request, signal) => {
  const { id, result } = startJob({
    kind: "rerank",
    ...request,
    maxLength: RERANK_MAX_TOKENS,
  });
  const cancel = () => cancelJob(id);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const payload = await result;
    if (payload.kind !== "rerank")
      throw new Error("The worker answered a rerank job with another kind");
    return payload.scores;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
};

/**
 * A scorer that replaces the worker, or null for the worker.
 *
 * Set by the search gate, which replays recorded scores so it needs no model,
 * and by its recorder, which records what the worker returns.
 */
let replacement: PairScorer | null = null;

/** Tests and the evaluation recorder only. Null puts the worker back. */
export function setPairScorer(scorer: PairScorer | null): void {
  replacement = scorer;
}

/** Models that have loaded on the worker in this process. */
const loaded = new Set<string>();

/** True when the stage can run: it is on, and its model has loaded. */
export function isCrossEncoderReady(model = rerankModel()): boolean {
  if (!model) return false;
  return replacement !== null || loaded.has(model);
}

/**
 * Load the model on the worker with one pair, once, at boot.
 *
 * Loading at boot keeps the model's load time, and a first download, off a
 * person's search. Returns false when the stage is off, when the worker
 * cannot run, or when the model does not load. Nothing else runs it on
 * this thread: the main thread must never load onnxruntime (see
 * `cpuWorker.ts`), and the stage is not worth a second copy of a model.
 */
export async function initCrossEncoder(
  model = rerankModel(),
): Promise<boolean> {
  if (!model) return false;
  if (loaded.has(model)) return true;
  if (!isWorkerActive()) {
    log.info(
      "CrossEncoder",
      "The CPU worker is not running, so search keeps its fused order",
    );
    return false;
  }
  const t0 = performance.now();
  try {
    const scores = await scoreOnWorker(
      { model, query: "contrack", docs: ["contrack"] },
      new AbortController().signal,
    );
    if (scores.length !== 1 || !Number.isFinite(scores[0]))
      throw new Error("The model returned no score");
    loaded.add(model);
    log.info(
      "CrossEncoder",
      `Model ${model} ready in ${Math.round(performance.now() - t0)}ms ` +
        `(${RERANK_CANDIDATES} candidates, ${rerankBudgetMs()}ms budget)`,
    );
    return true;
  } catch (err: unknown) {
    log.warn(
      "CrossEncoder",
      `The cross-encoder ${model} did not load, so search keeps its fused order: ${getErrorMessage(err)}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// The profile text
// ---------------------------------------------------------------------------

/** The contact fields the profile text reads. A hydrated contact has them all. */
export interface ProfileFields {
  name?: unknown;
  role?: unknown;
  company?: unknown;
  location?: unknown;
  industry?: unknown;
  headline?: unknown;
  about?: unknown;
  /** Rows of `{ tag }`, as `hydrate` returns them, or plain strings. */
  tags?: unknown;
  /** Rows of `{ interest }`, as `hydrate` returns them, or plain strings. */
  interests?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function words(rows: unknown, field: "tag" | "interest"): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: unknown) =>
      typeof row === "string"
        ? row
        : text((row as Record<string, unknown> | null)?.[field]),
    )
    .filter(Boolean);
}

/**
 * What the model reads for one contact: name, role, company, location,
 * industry, headline, the first 200 about characters, tags and interests.
 */
export function profileText(contact: ProfileFields): string {
  const tags = words(contact.tags, "tag");
  const interests = words(contact.interests, "interest");
  return [
    text(contact.name),
    text(contact.role),
    text(contact.company),
    text(contact.location),
    text(contact.industry),
    text(contact.headline),
    text(contact.about).slice(0, 200),
    tags.join(", "),
    interests.join(", "),
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, PROFILE_CHARS);
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/** For the benchmark, which compares models and candidate counts. */
export interface RerankOptions {
  /** The model. `SEARCH_RERANK_MODEL` when unset. */
  model?: string | null;
  /** How many candidates to score. `RERANK_CANDIDATES` when unset. */
  count?: number;
}

/**
 * Reorder the top of `candidates` by cross-encoder score, inside the budget.
 *
 * The top `RERANK_CANDIDATES` are scored and sorted, highest first, with the
 * list's own order as the tie break. The rest follow unchanged. When the
 * stage is off, not loaded, late or failing, the list comes back as it was.
 * The caller decides the query kind: only a question comes here.
 */
export async function rerankLocal<T extends ProfileFields>(
  query: string,
  candidates: T[],
  budgetMs = rerankBudgetMs(),
  options: RerankOptions = {},
): Promise<T[]> {
  const model = options.model === undefined ? rerankModel() : options.model;
  const top = candidates.slice(0, options.count ?? RERANK_CANDIDATES);
  if (!model || !isCrossEncoderReady(model) || top.length < 2 || budgetMs <= 0)
    return candidates;

  const t0 = performance.now();
  const late = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  let scores: number[] | null;
  try {
    scores = await Promise.race([
      (replacement ?? scoreOnWorker)(
        { model, query, docs: top.map(profileText) },
        late.signal,
      ),
      deadline,
    ]);
  } catch (err: unknown) {
    log.warn(
      "CrossEncoder",
      `Scoring failed, so the list keeps its fused order: ${getErrorMessage(err)}`,
    );
    scores = null;
  } finally {
    clearTimeout(timer);
  }

  // A busy event loop can deliver a worker message before an overdue
  // timer. Check elapsed time too, so late scores never change the order.
  if (!scores || performance.now() - t0 >= budgetMs) {
    late.abort();
    log.debug(
      "CrossEncoder",
      `Past the ${budgetMs}ms budget after ${Math.round(performance.now() - t0)}ms, so the list keeps its fused order`,
    );
    return candidates;
  }
  if (
    scores.length !== top.length ||
    !scores.every((score) => Number.isFinite(score))
  )
    return candidates;

  const reordered = top
    .map((candidate, index) => ({ candidate, index, score: scores[index] }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.candidate);
  return [...reordered, ...candidates.slice(top.length)];
}
