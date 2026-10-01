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

/** Why a source came back with nothing, in a sentence. */
function reason(outcome: SourceOutcome): string {
  if (outcome.kind === "failed") return getErrorMessage(outcome.error);
  if (outcome.kind === "no-match") return "no page matched.";
  return "found facts.";
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
      providerEvidence(contact, prompt, signal, asked, meter),
      searxngEvidence(contact, signal, asked, meter),
    ]);
    signal?.throwIfAborted();
    const outcomes = [provider, searxng];
    const found = outcomes.filter(
      (outcome): outcome is Evidence => outcome.kind === "facts",
    );
    log.info(
      "CombinedStrategy",
      `${contact.name} (${depth}): research model ${provider.kind === "facts" ? "found facts" : reason(provider)} SearXNG ${searxng.kind === "facts" ? "found facts" : reason(searxng)}`,
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
