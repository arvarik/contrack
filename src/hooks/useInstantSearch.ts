/**
 * Instant search: a synchronous filter over the cached slim contacts on each
 * keystroke, replaced by the FTS5 results once the debounced query (200 ms)
 * returns. Facet filters apply before the text match.
 */
import { useMemo } from "react";
import { matchesFacet } from "../../shared/searchFacets";
import {
  useSlimContactsForSearch,
  type SlimSearchContact,
} from "../api/contacts";
import { useSearchContacts } from "../api/search";
import { useDebounce } from "./useDebounce";
import type { FacetFilter } from "./useQueryTokenizer";
import type { Contact } from "../types";

interface InstantSearchResult {
  /** The display results (either client-filtered SlimSearchContact or FTS5-upgraded Contact) */
  results: (Contact | SlimSearchContact)[];
  /** True when showing instant client results (before FTS5 arrival) */
  isInstant: boolean;
  /** True when FTS5 query is in-flight */
  isFtsLoading: boolean;
}

/** The most instant results to show. */
const INSTANT_LIMIT = 20;

/**
 * @param query - The free text, with the facet tokens already taken out.
 * @param enabled - False returns no results.
 */
export function useInstantSearch(
  query: string,
  filters: FacetFilter[] = [],
  enabled: boolean = true,
): InstantSearchResult {
  const { data: slimContacts } = useSlimContactsForSearch();

  const clientResults = useMemo(() => {
    if (!enabled || !slimContacts?.length) return [];

    let pool = slimContacts;
    if (filters.length > 0) {
      pool = pool.filter((c) => filters.every((f) => matchesFacet(c, f)));
    }

    if (!query.trim()) {
      return filters.length > 0 ? pool.slice(0, INSTANT_LIMIT) : [];
    }

    const q = query.toLowerCase();
    const tokens = q.split(/\s+/).filter((t) => t.length > 0);

    return pool
      .filter((c) => {
        const searchableText = buildSearchableText(c);
        // Every word must match.
        return tokens.every((token) => searchableText.includes(token));
      })
      .slice(0, INSTANT_LIMIT);
  }, [query, filters, slimContacts, enabled]);

  const debouncedQuery = useDebounce(query, 200);

  const serverQuery = useMemo(() => {
    if (!enabled || !debouncedQuery.trim()) return "";
    return debouncedQuery;
  }, [debouncedQuery, enabled]);

  const {
    data: ftsResults = [],
    isFetching: ftsLoading,
    isPlaceholderData,
    isSuccess,
  } = useSearchContacts(serverQuery, filters);

  // The server's results still need the active facets.
  const filteredFtsResults = useMemo(() => {
    if (!ftsResults.length || filters.length === 0) return ftsResults;
    return ftsResults.filter((c) => filters.every((f) => matchesFacet(c, f)));
  }, [ftsResults, filters]);

  // The FTS5 results replace the instant ones once they match the query.
  const hasActiveFts =
    enabled &&
    serverQuery.length > 0 &&
    serverQuery === query &&
    isSuccess &&
    !isPlaceholderData;
  const hasClientResults = clientResults.length > 0;

  return {
    results: !enabled ? [] : hasActiveFts ? filteredFtsResults : clientResults,
    isInstant: !hasActiveFts && hasClientResults,
    isFtsLoading: ftsLoading && !!debouncedQuery.trim(),
  };
}

/** Build a lowercase searchable string from a slim contact's key fields */
function buildSearchableText(c: SlimSearchContact): string {
  const parts: string[] = [];
  if (c.name) parts.push(c.name.toLowerCase());
  if (c.role) parts.push(c.role.toLowerCase());
  if (c.company) parts.push(c.company.toLowerCase());
  if (c.location) parts.push(c.location.toLowerCase());
  if (c.industry) parts.push(c.industry.toLowerCase());
  if (c.tags?.length) {
    parts.push(c.tags.map((t) => t.tag.toLowerCase()).join(" "));
  }
  return parts.join(" ");
}
