// =============================================================================
// Research — the combined technique (the research model's search and a web
// search's, at once)
// =============================================================================
// Both searches at once, and the facts of both kept:
//
//   1. The research model's own search (`providerSearch`) and the request's
//      web search with its pages read (`searchAndRead`) run side by side.
//      Neither waits for the other, so the run takes as long as the slower.
//   2. The fact lines of every source that found some are merged, with their
//      pages, findings and searches (`mergeEvidence`), and one extraction
//      reads them.
//
// One source is enough. The research model decides for itself whether to
// search, and for a person with a small web footprint it often does not:
// the web search then stands alone. When the web search is down or finds
// nothing, the model's search stands alone. A run records no public
// information only when a source searched and matched nobody, and it fails
// only when neither source has facts or a no-match.
//
// Each search has a deadline of its own, the run's allowance less the time
// the extraction needs. A model that cites no page is asked twice more, and
// its two rounds can take 240 s, the whole of a Standard run. Without its own
// deadline, the run would stop with it, and the web search's facts, ready
// long before, would be lost. A small local model that reads the web
// search's pages in parts can be the slow one too.
// =============================================================================

import {
  NEEDS_FAST_MODEL,
  NEEDS_STRONG_MODEL,
  NEEDS_WEB_SEARCH_MODEL,
} from "../needs.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import { AppError } from "../../../utils/AppError.ts";
import {
  mergeEvidence,
  mergeNoMatches,
  type Evidence,
  type NoMatch,
  type SourceOutcome,
} from "../evidence.ts";
import type { ResearchRequest, Technique, TechniqueContext } from "../types.ts";
import { providerSearch } from "./providerSearch.ts";
import { searchAndRead } from "./searchAndRead.ts";

/**
 * Time kept from the run's allowance for the extraction after the searches:
 * its own 30 s limit, and some to spare.
 */
export const EXTRACTION_RESERVE_MS = 40_000;

/** Why a source came back with nothing, in a sentence. */
function reason(outcome: SourceOutcome): string {
  if (outcome.kind === "failed") return getErrorMessage(outcome.error);
  if (outcome.kind === "no-match") return "no page matched.";
  return "found facts.";
}

/**
 * One source's search, stopped at its own deadline when the run has one. A
 * source stopped there failed, and the other one's facts still count. A
 * cancelled run still throws.
 *
 * @param name - The source, for the reason: "The web search model's search".
 */
async function within(
  name: string,
  search: (signal: AbortSignal | undefined) => Promise<SourceOutcome>,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): Promise<SourceOutcome> {
  if (timeoutMs === undefined) return search(signal);
  const budgetMs = Math.max(timeoutMs - EXTRACTION_RESERVE_MS, 0);
  const deadline = AbortSignal.timeout(budgetMs);
  try {
    return await search(
      signal ? AbortSignal.any([signal, deadline]) : deadline,
    );
  } catch (err) {
    if (signal?.aborted || !deadline.aborted) throw err;
    return {
      kind: "failed",
      error: new AppError(
        `${name} took more than ${Math.round(budgetMs / 1000)} s.`,
        504,
        { code: "RESEARCH_SOURCE_TIMEOUT" },
      ),
    };
  }
}

/** Both searches at once, and the facts of every one that found some. */
async function searchBoth(
  request: ResearchRequest,
  ctx: TechniqueContext,
): Promise<SourceOutcome> {
  const { contact, depth, signal, timeoutMs } = request;
  const label = ctx.webSearch?.label ?? "The web search";
  const [provider, web] = await Promise.all([
    within(
      "The web search model's search",
      (bounded) => providerSearch.run({ ...request, signal: bounded }, ctx),
      signal,
      timeoutMs,
    ),
    within(
      `${label}'s search`,
      (bounded) => searchAndRead.run({ ...request, signal: bounded }, ctx),
      signal,
      timeoutMs,
    ),
  ]);
  signal?.throwIfAborted();
  const outcomes = [provider, web];
  const found = outcomes.filter(
    (outcome): outcome is Evidence => outcome.kind === "facts",
  );
  log.info(
    "Combined",
    `${contact.id} (${depth}): research model: ${reason(provider)} ${label}: ${reason(web)}`,
  );
  if (found.length > 0) return mergeEvidence(found);
  const noMatches = outcomes.filter(
    (outcome): outcome is NoMatch => outcome.kind === "no-match",
  );
  if (noMatches.length > 0) return mergeNoMatches(noMatches);
  return {
    kind: "failed",
    error: new AppError(
      `Neither search found facts. No contact fields changed. Web search model: ${reason(provider)} ${label}: ${reason(web)}`,
      502,
      { code: "RESEARCH_NO_EVIDENCE" },
    ),
  };
}

export const combined: Technique = {
  name: "combined",
  // Both searches, so both have to be there: the web search, the web search
  // model, the Strong model that reads the web search's pages and the Fast
  // one that extracts.
  needs: () => [
    { what: "web-search" },
    { what: "research", message: NEEDS_WEB_SEARCH_MODEL },
    { what: "deep", message: NEEDS_STRONG_MODEL },
    { what: "quick", message: NEEDS_FAST_MODEL },
  ],
  run: searchBoth,
};
