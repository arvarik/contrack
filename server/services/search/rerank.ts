// =============================================================================
// The rerank stage
// =============================================================================
// Reorders the top of the local list, the keyword and vector results fused by
// weighted reciprocal rank, with the reranker (`server/ai/reranker.ts`): the
// local cross-encoder unless a test or the search gate put another in place.
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
// =============================================================================

import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { currentReranker, type Reranker } from "../../ai/reranker.ts";

/** The budget when `SEARCH_RERANK_BUDGET_MS` is unset, in milliseconds. */
export const DEFAULT_RERANK_BUDGET_MS = 25;

/**
 * How many candidates from the top of the local list the model scores.
 *
 * The whole instant list: no extra retrieval, and well inside the budget.
 * 10, 20, 30 and 50 gave the same answers on the golden questions.
 */
export const RERANK_CANDIDATES = 30;

/**
 * Characters of profile text sent to the worker.
 *
 * The tokenizer cuts at 128 tokens anyway. This only keeps a long headline
 * from crossing the thread boundary for nothing.
 */
const PROFILE_CHARS = 600;

/** The budget the settings name. A value that is not a number is ignored. */
export function rerankBudgetMs(): number {
  const raw = process.env.SEARCH_RERANK_BUDGET_MS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_RERANK_BUDGET_MS;
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

/** For search and the benchmark, which compares models and candidate counts. */
export interface RerankOptions {
  /** The reranker. `currentReranker()` when unset, and none when null. */
  reranker?: Reranker | null;
  /** How many candidates to score. `RERANK_CANDIDATES` when unset. */
  count?: number;
  /** Query-selected evidence, in candidate order. */
  documents?: string[];
}

/**
 * Reorder the top of `candidates` by reranker score, inside the budget.
 *
 * The top `RERANK_CANDIDATES` are scored and sorted, highest first, with the
 * list's own order as the tie break. The rest follow unchanged. When the
 * stage is off, not loaded, late or failing, the list comes back as it was.
 * The caller decides the query kind, and whether a reranker that is not
 * local may read the question: only a question comes here.
 */
export async function rerankLocal<T extends ProfileFields>(
  query: string,
  candidates: T[],
  budgetMs = rerankBudgetMs(),
  options: RerankOptions = {},
): Promise<T[]> {
  const reranker =
    options.reranker === undefined ? currentReranker() : options.reranker;
  const top = candidates.slice(0, options.count ?? RERANK_CANDIDATES);
  if (!reranker?.ready() || top.length < 2 || budgetMs <= 0) return candidates;

  const t0 = performance.now();
  const late = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  let scores: number[] | null;
  try {
    scores = await Promise.race([
      reranker.score(
        query,
        top.map(
          (candidate, index) =>
            options.documents?.[index] ?? profileText(candidate),
        ),
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
