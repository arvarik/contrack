// =============================================================================
// AI Layer — Research sources, as the enrichment pipeline stores them
// =============================================================================
// Every provider reports the pages a grounded answer used in its own shape:
// Gemini's groundingChunks, OpenAI's web_search_call sources and url_citation
// annotations, Anthropic's web_search_tool_result blocks and text citations.
// Each adapter collects its own and hands them here, so the list the
// pipeline sees has one shape and one set of rules.
// =============================================================================

/** A page a provider says it read, in whatever fields it gave. */
export interface RawSource {
  url?: string | null;
  title?: string | null;
}

/** At most this many sources travel with one answer. */
export const MAX_CITATIONS = 30;

/**
 * http(s) only, with no credentials in the URL, deduplicated by URL, thirty
 * at most. A source with no title is named by its host, because OpenAI
 * returns bare URLs.
 */
export function toCitations(
  sources: RawSource[],
): Array<{ title: string; uri: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; uri: string }> = [];
  for (const source of sources) {
    const uri = source.url?.trim();
    if (!uri || seen.has(uri)) continue;
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      continue;
    seen.add(uri);
    const title = source.title?.trim() || url.hostname.replace(/^www\./, "");
    out.push({ title, uri });
    if (out.length >= MAX_CITATIONS) break;
  }
  return out;
}
