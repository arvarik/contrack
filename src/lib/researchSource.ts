/**
 * researchSource: where contact research searches the web, for the
 * Enrichment page's "Search with" choice and its confirmation.
 *
 * Three sources: the research model's own search (the provider, named by
 * its label, such as "Gemini"), a self-hosted SearXNG, or both at once with
 * the facts of both kept. The page offers the choice only when an admin has
 * set a SearXNG address and a provider serves research. Otherwise there is
 * one way to search, and the server picks it.
 *
 * @module lib/researchSource
 */

/** One way to search the web for a contact. */
export type ResearchSource = "provider" | "searxng" | "combined";

/** The sources in the order the choice lists them: the default first. */
export const SOURCE_ORDER: readonly ResearchSource[] = [
  "provider",
  "searxng",
  "combined",
];

/**
 * The strategy a start names for each source. The provider's own is the
 * server's default, so a start with it names none.
 */
export const SOURCE_STRATEGY: Record<
  ResearchSource,
  "searxng" | "combined" | undefined
> = {
  provider: undefined,
  searxng: "searxng",
  combined: "combined",
};

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
