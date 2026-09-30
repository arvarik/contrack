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

const RESEARCH_DEPTHS = ["standard", "deep"] as const;

export const researchDepthSchema = z.enum(RESEARCH_DEPTHS);

export type ResearchDepth = z.infer<typeof researchDepthSchema>;

/** The depth a start gets when it names none. */
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = "standard";

/** What one contact takes at a depth: the time, the searches and the cost. */
interface ResearchDepthFigures {
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
 * prices through 2026. Its token prices double in January 2027, so measure
 * again then (the cost tip names 2026 as the year of its prices). The
 * figures describe research on Gemini only, and the controls leave them
 * out on another provider (`depthFiguresApply`).
 */
export const RESEARCH_DEPTH_FIGURES: Record<
  ResearchDepth,
  ResearchDepthFigures
> = {
  standard: { seconds: 41, searches: 8, costUsd: 0.15 },
  deep: { seconds: 60, searches: 18, costUsd: 0.32 },
};

// -----------------------------------------------------------------------------
// What one contact costs on each provider
// -----------------------------------------------------------------------------
// The cost tip beside "Research depth" compares the three providers Contrack
// can run research on. Google's figures are the measured ones above. The other
// two are estimates: the same searches and tokens, at their list prices.
// -----------------------------------------------------------------------------

/** The providers research can run on, by the id the AI settings use. */
export const RESEARCH_PROVIDERS = ["gemini", "anthropic", "openai"] as const;

export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

/** One provider's list prices for research, in US dollars, for 2026. */
interface ResearchPrices {
  providerLabel: string;
  /** The model research uses (the `flash` tier), by the id the usage page prices. */
  modelId: string;
  modelLabel: string;
  /** Per million input tokens. */
  inputPerM: number;
  /** Per million output tokens. */
  outputPerM: number;
  /** Per 1,000 web searches. */
  searchPer1000: number;
  /** Searches a month the provider does not bill. Only Google lists any. */
  freeSearchesPerMonth?: number;
}

/**
 * The prices, read from the providers' own pages on 2026-09-29 (Google's
 * Gemini API pricing page, Anthropic's pricing page and OpenAI's pricing
 * page). Gemini 3.8 Flash's token prices run to December 31, 2026. Google
 * does not bill the first 5,000 searches a month on Gemini 3. The Claude web
 * search page and the OpenAI pricing page list no free searches, so those two
 * have none. Both also bill the tokens of the pages a search returns, and the
 * token volume below is Gemini's, so their estimates can run low or high.
 * `server/ai/pricing.ts` holds the same token prices, and a test keeps the
 * two equal.
 */
export const RESEARCH_PRICES: Record<ResearchProvider, ResearchPrices> = {
  gemini: {
    providerLabel: "Google",
    modelId: "gemini-3.8-flash",
    modelLabel: "Gemini 3.8 Flash",
    inputPerM: 0.75,
    outputPerM: 3.75,
    searchPer1000: 14,
    freeSearchesPerMonth: 5000,
  },
  anthropic: {
    providerLabel: "Anthropic",
    modelId: "claude-sonnet-5-5",
    modelLabel: "Claude Sonnet 5.5",
    inputPerM: 2,
    outputPerM: 10,
    searchPer1000: 10,
  },
  openai: {
    providerLabel: "OpenAI",
    modelId: "gpt-6.1-sol",
    modelLabel: "GPT-6.1 Sol",
    inputPerM: 2,
    outputPerM: 10,
    searchPer1000: 10,
  },
};

/**
 * The tokens one contact uses at each depth. The measured cost of a depth,
 * less its searches at Google's price, is what its tokens cost: $0.038
 * Standard and $0.068 Deep. Divided by Gemini 3.8 Flash's blended rate of
 * $1.50 a million tokens (three parts input to one part output, as the usage
 * page blends) that is about 25,000 and 45,000 tokens.
 */
const TOKENS_PER_CONTACT: Record<ResearchDepth, number> = {
  standard: 25_000,
  deep: 45_000,
};

/**
 * What one contact costs at a depth on a provider, in US dollars: the
 * measured searches at the provider's search price, and the tokens at its
 * blended token price.
 */
export function estimateCostUsd(
  provider: ResearchProvider,
  depth: ResearchDepth,
): number {
  const prices = RESEARCH_PRICES[provider];
  const blendedPerM = (3 * prices.inputPerM + prices.outputPerM) / 4;
  const searches =
    (RESEARCH_DEPTH_FIGURES[depth].searches * prices.searchPer1000) / 1000;
  const tokens = (TOKENS_PER_CONTACT[depth] * blendedPerM) / 1_000_000;
  return searches + tokens;
}
