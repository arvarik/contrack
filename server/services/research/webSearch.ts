// =============================================================================
// Research — the web searches
// =============================================================================
// The search services a technique can search the web with, by id. SearXNG is
// the only one. Another service is one adapter here and its settings: the
// techniques read results, not services.
//
// A web search's error codes start with its id in capitals, such as
// SEARXNG_NOT_CONFIGURED, so each service keeps codes of its own.
// =============================================================================

import { AppError } from "../../utils/AppError.ts";
import type { WebSearch } from "./types.ts";
import { searxngWebSearch } from "./webSearch/searxng.ts";

/** The web search a technique uses when the request names none. */
export const DEFAULT_WEB_SEARCH = "searxng";

const WEB_SEARCHES = new Map<string, WebSearch>([
  [searxngWebSearch.id, searxngWebSearch],
]);

/** A web search that a test put beside the registered ones. */
let replacement: WebSearch | null = null;

/**
 * Use `webSearch` for its id, beside the registered ones or in place of the
 * one with the same id. Null goes back. Tests only.
 */
export function setWebSearch(webSearch: WebSearch | null): void {
  replacement = webSearch;
}

/** The web search with this id, or undefined. */
function findWebSearch(id: string): WebSearch | undefined {
  return replacement?.id === id ? replacement : WEB_SEARCHES.get(id);
}

/** True when a web search has this id. */
export function isWebSearch(id: string): boolean {
  return findWebSearch(id) !== undefined;
}

/** The web search with this id. Throws 400 for an id nothing has. */
export function webSearchNamed(id: string): WebSearch {
  const webSearch = findWebSearch(id);
  if (!webSearch)
    throw new AppError(
      `Unknown web search: "${id}". Available: ${[...WEB_SEARCHES.keys()].join(", ")}`,
      400,
    );
  return webSearch;
}

/** One of a web search's error codes: `webSearchCode(searxng, "NO_RESULTS")` is SEARXNG_NO_RESULTS. */
export function webSearchCode(webSearch: WebSearch, what: string): string {
  return `${webSearch.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${what}`;
}

/** The refusal while a web search is not set up. */
export function webSearchUnset(webSearch: WebSearch): AppError {
  return new AppError(
    `${webSearch.label} is not set up. An admin sets it in Settings → Administration → General.`,
    503,
    { code: webSearchCode(webSearch, "NOT_CONFIGURED") },
  );
}
