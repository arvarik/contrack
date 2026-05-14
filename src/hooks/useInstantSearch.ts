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

  const { data: ftsResults = [], isLoading: ftsLoading } =
    useSearchContacts(serverQuery);

  // ── 3. Apply facet post-filter on FTS results ───────────────────────────
  // FTS results are server-side; we still need to filter by any active facets
  const filteredFtsResults = useMemo(() => {
    if (!ftsResults.length || filters.length === 0) return ftsResults;
    return ftsResults.filter((c) =>
      filters.every((f) => matchesFacetOnContact(c, f)),
    );
  }, [ftsResults, filters]);

  // ── 4. Handover logic ───────────────────────────────────────────────────
  // FTS results replace client results when available
  const hasActiveFts =
    filteredFtsResults.length > 0 && debouncedQuery.trim().length > 0;
  const hasClientResults = clientResults.length > 0;

  return {
    results: hasActiveFts ? filteredFtsResults : clientResults,
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

/** Match a facet filter against a SlimSearchContact */
function matchesFacet(
  contact: SlimSearchContact,
  filter: FacetFilter,
): boolean {
  const v = filter.value.toLowerCase();

  switch (filter.field) {
    case "role":
      return contact.role?.toLowerCase().includes(v) ?? false;
    case "company":
      return contact.company?.toLowerCase().includes(v) ?? false;
    case "location":
      return contact.location?.toLowerCase().includes(v) ?? false;
    case "industry":
      return contact.industry?.toLowerCase().includes(v) ?? false;
    case "tag":
      return contact.tags.some((t) => t.tag.toLowerCase().includes(v));
    case "score":
      return matchesScoreFilter(contact.relationshipScore, filter);
    case "updated":
      return matchesDateFilter(contact.updatedAt, filter);
    default:
      return true;
  }
}

/** Match a facet filter against a full Contact (for FTS post-filtering) */
function matchesFacetOnContact(contact: Contact, filter: FacetFilter): boolean {
  const v = filter.value.toLowerCase();

  switch (filter.field) {
    case "role":
      return contact.role?.toLowerCase().includes(v) ?? false;
    case "company":
      return contact.company?.toLowerCase().includes(v) ?? false;
    case "location":
      return contact.location?.toLowerCase().includes(v) ?? false;
    case "industry":
      return contact.industry?.toLowerCase().includes(v) ?? false;
    case "tag":
      return (contact.tags ?? []).some((t) => t.tag.toLowerCase().includes(v));
    case "score":
      return matchesScoreFilter(contact.relationshipScore ?? null, filter);
    case "updated":
      return matchesDateFilter(contact.updatedAt, filter);
    default:
      return true;
  }
}

/** Score comparison: score:>80, score:<40 */
function matchesScoreFilter(
  score: number | null,
  filter: FacetFilter,
): boolean {
  if (score === null || score === undefined) return false;
  const threshold = parseInt(filter.value, 10);
  if (isNaN(threshold)) return false;

  const op = filter.operator || ">";
  return op === ">" ? score >= threshold : score <= threshold;
}

/** Date comparison: updated:>3m (older than 3 months), updated:<1m (newer than 1 month) */
function matchesDateFilter(
  dateStr: string | null,
  filter: FacetFilter,
): boolean {
  if (!dateStr) return false;

  const match = filter.value.match(/^(\d+)([dwmy])$/i);
  if (!match) return false;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const daysMap: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
  const days = amount * (daysMap[unit] ?? 30);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const contactDate = new Date(dateStr);
  const op = filter.operator || ">";

  // "updated:>3m" means "last updated MORE than 3 months ago" (older)
  return op === ">" ? contactDate < cutoffDate : contactDate >= cutoffDate;
}
