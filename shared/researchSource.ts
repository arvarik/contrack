// =============================================================================
// Research source: where contact research searches the web
// =============================================================================
// Three sources, each run by a strategy on the server:
//
//   provider  the research model's own web search ("two-pass"), the default
//   searxng   a self-hosted SearXNG runs the searches, and the deep model
//             reads the pages ("searxng")
//   combined  both at once, with the facts of both kept ("combined")
//
// Each account keeps one choice, the `researchSource` preference. Every
// start that names no strategy uses it: the Enrichment page, the Enrich menu
// of a contact, "Enrich new contacts automatically", and an API call. The
// choice counts only while an admin has set a SearXNG address and a provider
// serves research. Otherwise there is one way to search, and the server
// picks it.
// =============================================================================

import { z } from "zod";

export const researchSourceSchema = z.enum(["provider", "searxng", "combined"]);

export type ResearchSource = z.infer<typeof researchSourceSchema>;

/** The source an account has before it chooses. */
export const DEFAULT_RESEARCH_SOURCE: ResearchSource = "provider";

/**
 * The strategy each source runs as. Every provider researches with
 * two-pass, which is the server's default whenever a provider serves
 * research.
 */
export const SOURCE_STRATEGY: Record<
  ResearchSource,
  "two-pass" | "searxng" | "combined"
> = {
  provider: "two-pass",
  searxng: "searxng",
  combined: "combined",
};
