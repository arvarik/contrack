/**
 * researchSource: the words for where contact research searches the web,
 * for the Enrichment page's "Search with" choice, its confirmation, and a
 * contact's Enrich menu.
 *
 * Three sources (`shared/researchSource`): the research model's own search
 * (the provider, named by its label, such as "Gemini"), a self-hosted
 * SearXNG, or both at once with the facts of both kept. The page offers the
 * choice only when an admin has set a SearXNG address and a provider serves
 * research. Otherwise there is one way to search, and the server picks it.
 *
 * @module lib/researchSource
 */
import type { ResearchSource } from "../../shared/researchSource";

/** The sources in the order the choice lists them: the default first. */
export const SOURCE_ORDER: readonly ResearchSource[] = [
  "provider",
  "searxng",
  "combined",
];

/**
 * Each source's name, and what it does in a few words.
 *
 * @param provider - The research provider's label, such as "Gemini".
 */
export function sourceWords(
  provider: string,
): Record<ResearchSource, { name: string; does: string }> {
  return {
    provider: {
      name: provider,
      does: `${provider} decides what to search`,
    },
    searxng: {
      name: "SearXNG",
      does: "Your SearXNG searches, and AI reads the pages",
    },
    combined: {
      name: "Both",
      does: `${provider} and SearXNG at once, keeping the facts of both`,
    },
  };
}

/**
 * What a source searches with, as a phrase: "SearXNG", or "Gemini and
 * SearXNG" for both.
 *
 * @param provider - The research provider's label, such as "Gemini".
 */
export function searchesWith(provider: string, source: ResearchSource): string {
  if (source === "combined") return `${provider} and SearXNG`;
  return sourceWords(provider)[source].name;
}
