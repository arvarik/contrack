/**
 * useInstantSearch — Zero-latency client-side search with FTS5 handover.
 *
 * Architecture (Feature 8 — Latency Masking):
 *
 *   Keystroke → Synchronous client filter (0ms) → Display immediately
 *           ↘ Debounced FTS5 query (200ms) → Replace results seamlessly
 *
 * Also supports faceted filters (Feature 5):
 *   FacetFilter[] is applied as a pre-filter before text matching.
 *
 * @module hooks/useInstantSearch
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstantSearchResult {
  /** The display results (either client-filtered SlimSearchContact or FTS5-upgraded Contact) */
  results: (Contact | SlimSearchContact)[];
  /** True when showing instant client results (before FTS5 arrival) */
  isInstant: boolean;
  /** True when FTS5 query is in-flight */
  isFtsLoading: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum instant results to show (prevents overwhelming the list) */
const INSTANT_LIMIT = 20;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides zero-latency search results by filtering the in-memory slim
 * contact cache synchronously, then seamlessly swapping in FTS5 results
 * when they arrive ~200ms later.
 *
 * @param query - Raw free-text query (after facet tokens are stripped)
 * @param filters - Active facet filters to pre-filter contacts
 * @param enabled - Whether search should be active (false = returns empty)
 */
export function useInstantSearch(
  query: string,
  filters: FacetFilter[] = [],
  enabled: boolean = true,
): InstantSearchResult {
  const { data: slimContacts } = useSlimContactsForSearch();

  // ── 1. Synchronous client-side filter (0ms) ─────────────────────────────
  const clientResults = useMemo(() => {
    if (!enabled || !slimContacts?.length) return [];

    // Step 1: Apply facet pre-filters
    let pool = slimContacts;
    if (filters.length > 0) {
      pool = pool.filter((c) => filters.every((f) => matchesFacet(c, f)));
    }

    // Step 2: If no text query, return facet-filtered results
    if (!query.trim()) {
      return filters.length > 0 ? pool.slice(0, INSTANT_LIMIT) : [];
    }

    // Step 3: Text search across searchable fields
    const q = query.toLowerCase();
    const tokens = q.split(/\s+/).filter((t) => t.length > 0);

    return pool
      .filter((c) => {
        const searchableText = buildSearchableText(c);
        // All tokens must match (AND logic for multi-word queries)
        return tokens.every((token) => searchableText.includes(token));
      })
      .slice(0, INSTANT_LIMIT);
  }, [query, filters, slimContacts, enabled]);

  // ── 2. Debounced FTS5 query (fires ~200ms after last keystroke) ──────────
  const debouncedQuery = useDebounce(query, 200);

  // Build server query with filters
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

  // ── 3. Apply facet post-filter on FTS results ───────────────────────────
  // FTS results are server-side; we still need to filter by any active facets
  const filteredFtsResults = useMemo(() => {
    if (!ftsResults.length || filters.length === 0) return ftsResults;
    return ftsResults.filter((c) => filters.every((f) => matchesFacet(c, f)));
  }, [ftsResults, filters]);

  // ── 4. Handover logic ───────────────────────────────────────────────────
  // FTS results replace client results when available
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
