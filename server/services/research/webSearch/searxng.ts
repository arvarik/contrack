// =============================================================================
// Research — SearXNG, a self-hosted web search
// =============================================================================
// A SearXNG instance answers each query through its JSON API. The admin sets
// its address in Settings → Administration → AI → Web search, or with
// SEARXNG_URL.
//
// The instance is the admin's own and often has a private address, so this
// call does not go through the public-URL guard. The result pages do: the
// technique that reads them fetches each one with safeFetch.
// =============================================================================

import { readBodyCapped } from "../../../utils/urlSafety.ts";
import { AppError } from "../../../utils/AppError.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import { getSearxngUrl } from "../../integrationSettings.ts";
import type { WebResult, WebSearch } from "../types.ts";

/** One result as SearXNG's JSON API sends it. */
interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
}

/** The longest one search may take. */
const SEARCH_TIMEOUT_MS = 15_000;

/** Query SearXNG's JSON API. */
async function searxngSearch(
  baseUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearxngResult[]> {
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "0");
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])
      : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new AppError(
      `SearXNG returned ${response.status} ${response.statusText}`,
      502,
      { code: "SEARXNG_ERROR" },
    );
  }
  const body = JSON.parse(await readBodyCapped(response, signal)) as {
    results?: SearxngResult[];
  };
  return body.results ?? [];
}

export const searxngWebSearch: WebSearch = {
  id: "searxng",
  label: "SearXNG",
  configured: () => getSearxngUrl() !== null,
  async search(query, { limit, signal }): Promise<WebResult[]> {
    // Read at each search, so a batch that started before an admin cleared
    // the address searches no further.
    const baseUrl = getSearxngUrl();
    if (!baseUrl)
      throw new AppError("No SearXNG instance is configured", 503, {
        code: "SEARXNG_NOT_CONFIGURED",
      });
    try {
      const results = await searxngSearch(baseUrl, query, signal);
      return results
        .flatMap((result) =>
          result.url
            ? [
                {
                  url: result.url,
                  title: result.title ?? "",
                  snippet: result.content ?? "",
                },
              ]
            : [],
        )
        .slice(0, limit);
    } catch (err) {
      // SearXNG's own answer says why, such as the 403 of an instance whose
      // settings.yml leaves json out of search.formats.
      if (signal?.aborted || err instanceof AppError) throw err;
      throw new AppError(
        `SearXNG did not answer: ${getErrorMessage(err)}`,
        502,
        { code: "SEARXNG_ERROR" },
      );
    }
  },
};
