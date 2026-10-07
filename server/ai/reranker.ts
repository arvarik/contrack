// The reranker. Search reorders the top of its local list through one
// interface, `Reranker`. One adapter implements it: a small cross-encoder on
// the CPU worker, `Xenova/ms-marco-TinyBERT-L-2-v2` unless
// `SEARCH_RERANK_MODEL` names another. A cross-encoder reads the question and
// one profile together, so "someone who knows about beekeeping" ranks a profile
// by what it says, not by which words or vectors happen to be close. The stage
// that uses it, with its budget and candidates, is
// `server/services/search/rerank.ts`.
//
// `local` is the privacy fact: the cross-encoder runs on this server, so it
// orders an AI-off account's list. A reranker that sends the question and
// profiles to a service is not local, and runs only where AI is allowed.
//
// The model loads once, on the worker, at startup (`initCrossEncoder`). Until
// it loads, or when it cannot, the stage is skipped. `SEARCH_RERANK_MODEL=off`
// turns it off.

import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { cancelJob, isWorkerActive, startJob } from "../workers/cpuHost.ts";
import { describeModelLoadError } from "../services/search/modelFiles.ts";

/** A model that scores documents against a question. */
export interface Reranker {
  /** The model. A list it ordered is cached under it. */
  readonly id: string;
  /**
   * True when it runs on this server, so the question and the profiles stay
   * here. Search runs a reranker that is not local only where AI is allowed.
   */
  readonly local: boolean;
  /** True when `score` can answer now. */
  ready(): boolean;
  /**
   * One score per document, in the order sent, higher is more relevant. The
   * signal aborts once the scores are too late to use.
   */
  score(query: string, docs: string[], signal: AbortSignal): Promise<number[]>;
}

/**
 * The model when `SEARCH_RERANK_MODEL` is unset. Against
 * `Xenova/ms-marco-MiniLM-L-6-v2` (`scripts/benchmark-search.ts
 * --rerank-sweep`), both lift the golden questions alike, MRR 0.983 to 0.993 at
 * 5,000 contacts, and only this one fits the budget: 10.5 ms at p95 for 30
 * candidates, where MiniLM-L-6 needs 30.8 ms for 10.
 */
export const DEFAULT_RERANK_MODEL = "Xenova/ms-marco-TinyBERT-L-2-v2";

/** Tokens per (question, profile) pair. The end of a longer profile is cut. */
export const RERANK_MAX_TOKENS = 128;

/** The model the settings name, or null when the stage is off. */
export function rerankModel(): string | null {
  const value = process.env.SEARCH_RERANK_MODEL?.trim();
  if (value?.toLowerCase() === "off") return null;
  return value || DEFAULT_RERANK_MODEL;
}

// The cross-encoder on the CPU worker

/** Models that have loaded on the worker in this process. */
const loaded = new Set<string>();

/** Score on the CPU worker. A job still queued when the signal aborts never runs. */
async function scoreOnWorker(
  model: string,
  query: string,
  docs: string[],
  signal: AbortSignal,
): Promise<number[]> {
  const { id, result } = startJob({
    kind: "rerank",
    model,
    query,
    docs,
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
}

/** One adapter per model, so a caller can hold on to it. */
const crossEncoders = new Map<string, Reranker>();

/** The cross-encoder `model` on the CPU worker. Ready once it has loaded. */
export function crossEncoder(model: string): Reranker {
  let reranker = crossEncoders.get(model);
  if (!reranker) {
    reranker = {
      id: model,
      local: true,
      ready: () => loaded.has(model),
      score: (query, docs, signal) => scoreOnWorker(model, query, docs, signal),
    };
    crossEncoders.set(model, reranker);
  }
  return reranker;
}

/**
 * Load the model on the worker with one pair, once, at boot, so its load (and a
 * first download) is not on somebody's search. False when the stage is off, the
 * worker cannot run, or the model does not load. It never runs on this thread:
 * the main thread must never load onnxruntime (`cpuWorker.ts`), and the stage
 * is not worth a second copy of a model.
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
      model,
      "contrack",
      ["contrack"],
      new AbortController().signal,
    );
    if (scores.length !== 1 || !Number.isFinite(scores[0]))
      throw new Error("The model returned no score");
    loaded.add(model);
    log.info(
      "CrossEncoder",
      `Model ${model} ready in ${Math.round(performance.now() - t0)}ms`,
    );
    return true;
  } catch (err: unknown) {
    log.warn(
      "CrossEncoder",
      `The cross-encoder ${model} did not load, so search keeps its fused order: ${describeModelLoadError(getErrorMessage(err), model)}`,
    );
    return false;
  }
}

// The choice

/** A reranker that a test or the evaluation recorder put in place. */
let replacement: Reranker | null = null;

/**
 * Use `reranker` for every model name; null puts the cross-encoder back. For
 * the search gate, which replays recorded scores without a model, its recorder,
 * and tests.
 */
export function setReranker(reranker: Reranker | null): void {
  replacement = reranker;
}

/** The reranker for a model name, or null when there is no name. */
export function rerankerFor(model: string | null): Reranker | null {
  if (!model) return null;
  return replacement ?? crossEncoder(model);
}

/** The reranker the settings name, or null when the stage is off. */
export function currentReranker(): Reranker | null {
  return rerankerFor(rerankModel());
}
