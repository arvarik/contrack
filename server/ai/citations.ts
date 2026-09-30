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

/** Google's grounding redirect, the one kind of source link resolved. */
function isGroundingRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return (
      url.protocol === "https:" &&
      url.hostname === "vertexaisearch.cloud.google.com" &&
      url.pathname.startsWith("/grounding-api-redirect/")
    );
  } catch {
    return false;
  }
}

/**
 * The page each Gemini grounding redirect points to.
 *
 * Gemini names a source by a vertexaisearch.cloud.google.com link and the
 * bare domain. The link says nothing about the page, and it stops working
 * after a while. So each one is resolved once, while the research runs: a
 * HEAD request to Google, whose `Location` header is the page. The page itself
 * is never requested. A link that does not answer in time is left out of the
 * map, so its caller keeps the redirect.
 *
 * @param uris - Addresses as a provider gave them; others are ignored.
 * @param options.signal - The research job's abort signal.
 * @param options.timeoutMs - Per link. Every link resolves in parallel.
 * @param options.fetchImpl - Test seam; the global fetch by default.
 * @returns Each resolved redirect, mapped to its page.
 */
export async function resolveRedirects(
  uris: readonly string[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Map<string, string>> {
  const { signal, timeoutMs = 5_000, fetchImpl = fetch } = options;
  const pages = new Map<string, string>();
  await Promise.all(
    [...new Set(uris)].filter(isGroundingRedirect).map(async (uri) => {
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await fetchImpl(uri, {
          method: "HEAD",
          redirect: "manual",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location)
          pages.set(uri, new URL(location, uri).toString());
      } catch {
        // Keep the redirect.
      }
    }),
  );
  signal?.throwIfAborted();
  return pages;
}
