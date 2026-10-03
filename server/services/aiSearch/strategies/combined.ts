// =============================================================================
// AI Search — Combined Strategy (the research model's search and SearXNG)
// =============================================================================
// Both web searches at once, and the facts of both kept:
//
//   1. The research model's own search (`providerEvidence`, the first pass of
//      two-pass research) and SearXNG's (`searxngEvidence`) run side by side.
//      Neither waits for the other, so the run takes as long as the slower.
//   2. The fact lines of every source that found some are read into the
//      output schema by one extraction, and their pages, findings and
//      searches are merged (`foundResult`).
//
// One source is enough. The research model decides for itself whether to
// search, and for a person with a small web footprint it often does not:
// SearXNG's searches then stand alone. When SearXNG is down or finds nothing,
// the model's search stands alone. A run records no public information only
// when a source searched and matched nobody, and it fails only when neither
// source has facts or a no-match.
//
// Each search has a deadline of its own, the run's allowance less the time
// the extraction needs. A model that cites no page is asked twice more, and
// its two rounds can take 240 s, the whole of a Standard run. Without its own
// deadline, the run would stop with it, and SearXNG's facts, ready long
// before, would be lost. A small local model that reads SearXNG's pages in
// parts can be the slow one too.
// =============================================================================

import type { HydratedContact } from "../../../repositories/types.ts";
import type {
  AISearchStrategy,
  AISearchResult,
  ResearchOptions,
} from "../types.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import { AppError } from "../../../utils/AppError.ts";
import { DEFAULT_RESEARCH_DEPTH } from "../../../../shared/researchDepth.ts";
import {
  createMeter,
  extractFacts,
  foundResult,
  noMatchResult,
  type Evidence,
  type NoMatch,
  type SourceOutcome,
} from "./evidence.ts";
import { providerEvidence } from "./twoPass.ts";
import { searxngEvidence } from "./searxng.ts";

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
 * @param name - The source, for the reason: "The research model's search".
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

export class CombinedStrategy implements AISearchStrategy {
  readonly name = "combined";

  async execute(
    contact: HydratedContact,
    prompt: string,
    signal?: AbortSignal,
    options: ResearchOptions = {},
  ): Promise<AISearchResult> {
    signal?.throwIfAborted();
    const startMs = Date.now();
    const depth = options.depth ?? DEFAULT_RESEARCH_DEPTH;
    const meter = createMeter();
    const asked = { ...options, depth };

    // ── Pass 1: both searches at once ─────────────────────────────────
    const [provider, searxng] = await Promise.all([
      within(
        "The research model's search",
        (bounded) => providerEvidence(contact, prompt, bounded, asked, meter),
        signal,
        options.timeoutMs,
      ),
      within(
        "SearXNG's search",
        (bounded) => searxngEvidence(contact, bounded, asked, meter),
        signal,
        options.timeoutMs,
      ),
    ]);
    signal?.throwIfAborted();
    const outcomes = [provider, searxng];
    const found = outcomes.filter(
      (outcome): outcome is Evidence => outcome.kind === "facts",
    );
    log.info(
      "CombinedStrategy",
      `${contact.name} (${depth}): research model: ${reason(provider)} SearXNG: ${reason(searxng)}`,
    );

    if (found.length === 0) {
      const noMatches = outcomes.filter(
        (outcome): outcome is NoMatch => outcome.kind === "no-match",
      );
      if (noMatches.length > 0)
        return noMatchResult(noMatches, meter, depth, startMs);
      throw new AppError(
        `Neither search found facts. No contact fields changed. Research model: ${reason(provider)} SearXNG: ${reason(searxng)}`,
        502,
        { code: "RESEARCH_NO_EVIDENCE" },
      );
    }

    // ── Pass 2: one extraction over the facts of both ─────────────────
    const read = await extractFacts(
      contact,
      found.map((source) => source.facts).join("\n"),
      signal,
      meter,
      "quick",
      "CombinedStrategy",
    );
    return foundResult(found, read, meter, depth, startMs);
  }
}
