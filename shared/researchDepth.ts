// =============================================================================
// Research depth: how thoroughly one enrichment researches a contact
// =============================================================================
// Two depths, one name each, used the same way by the API, the job queue,
// the research record and every control that starts research:
//
//   standard  one search ask at thinking "medium", for the main facts, with
//             four to six searches
//   deep      the same ask, and beside it one at thinking "high" for a
//             complete profile, with ten or more searches; what both cite
//             is kept
//
// "High" found more when it answered, but it came back empty for some
// contacts on every try (2026-09-26). Beside the "medium" ask, an empty
// answer costs its tokens and the "medium" one still stands.
//
// The web searches are most of the cost. Google bills Gemini 3 each search
// query the model runs, and the tokens of a pass cost a fraction of its
// searches.
// =============================================================================

import { z } from "zod";

export const RESEARCH_DEPTHS = ["standard", "deep"] as const;

export const researchDepthSchema = z.enum(RESEARCH_DEPTHS);

export type ResearchDepth = z.infer<typeof researchDepthSchema>;

/** The depth a start gets when it names none. */
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = "standard";

/** What one contact takes at a depth: the time, the searches and the cost. */
export interface ResearchDepthFigures {
  /** The mean time per contact, in seconds. */
  seconds: number;
  /** The mean web searches per contact. */
  searches: number;
  /** The mean cost per contact, in US dollars, at Gemini's prices. */
  costUsd: number;
}

/**
 * The measured figures, the Enrichment page's time and cost for each depth.
 * Five contacts from real records, with Gemini 3.8 Flash and 3.5 Flash-Lite
 * (2026-09-26): the means over the runs that found pages, ten at Standard in
 * three rounds and six at Deep in two. A contact no page is about took 15 to
 * 65 s and cost $0.01 to $0.06. The cost is $14 per 1,000 web searches, and
 * $0.75 and $3.75 per million input and output tokens, Gemini 3.8 Flash's
 * prices through 2026.
 */
export const RESEARCH_DEPTH_FIGURES: Record<
  ResearchDepth,
  ResearchDepthFigures
> = {
  standard: { seconds: 41, searches: 8, costUsd: 0.15 },
  deep: { seconds: 60, searches: 18, costUsd: 0.32 },
};
