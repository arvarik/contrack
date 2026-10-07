// Research depth: how thoroughly one enrichment researches a contact. The
// API, the job queue, the research record and every control use these names:
//
//   standard  one plain search ask at thinking "medium"
//   deep      the same ask, and beside it the long prompt with the records
//             and the searches to run, also at "medium"; what both cite is
//             kept
//
// Neither asks at "high": a deep ask at "high" came back empty for 13 of 64
// contacts and wrote a namesake's facts into 3.
//
// The web searches are most of the cost: Google bills Gemini 3 per search
// query, and a pass's tokens cost a fraction of that.

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
 * The Enrichment page's measured time and cost per depth. Twenty contacts
 * imported from LinkedIn, with Gemini 3.8 Flash and 3.5 Flash-Lite: the
 * means over the runs that added details, 17 at Standard and 19 at Deep.
 * The cost is $14 per 1,000 web searches, and $0.75 and $3.75 per million
 * input and output tokens, Gemini 3.8 Flash's prices through 2026. Its token
 * prices double in January 2027, so measure again then (the cost tip names
 * 2026 as the year of its prices). Gemini only: the controls leave them out
 * on another provider (`depthFiguresApply`).
 */
export const RESEARCH_DEPTH_FIGURES: Record<
  ResearchDepth,
  ResearchDepthFigures
> = {
  standard: { seconds: 20, searches: 5, costUsd: 0.08 },
  deep: { seconds: 32, searches: 7, costUsd: 0.13 },
};

// What one contact costs on each provider, for the cost tip beside "Research
// depth". Google's figures are measured. The other two are estimates: the
// same searches and tokens, at their list prices.

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
 * The providers' list prices. Gemini 3.8 Flash's token prices run to
 * December 31, 2026. Google does not bill the first 5,000 searches a month on
 * Gemini 3. Anthropic and OpenAI list no free searches, and bill the tokens
 * of the pages a search returns, so their estimates, on Gemini's token
 * volume, can run low or high. A test holds the token prices equal to
 * `server/ai/pricing.ts`.
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
 * The tokens one contact uses at each depth, thinking included, measured
 * with the figures above: about 5,300 at Standard and 13,000 at Deep. About
 * half of them are output, because research thinks, and thinking is billed
 * as output.
 */
const TOKENS_PER_CONTACT: Record<ResearchDepth, number> = {
  standard: 5_300,
  deep: 13_000,
};

/**
 * What one contact costs at a depth on a provider, in US dollars: the
 * measured searches at the provider's search price, and the tokens at its
 * input and output prices, half each.
 */
export function estimateCostUsd(
  provider: ResearchProvider,
  depth: ResearchDepth,
): number {
  const prices = RESEARCH_PRICES[provider];
  const blendedPerM = (prices.inputPerM + prices.outputPerM) / 2;
  const searches =
    (RESEARCH_DEPTH_FIGURES[depth].searches * prices.searchPer1000) / 1000;
  const tokens = (TOKENS_PER_CONTACT[depth] * blendedPerM) / 1_000_000;
  return searches + tokens;
}
