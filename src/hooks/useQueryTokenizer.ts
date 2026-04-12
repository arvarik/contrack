/**
 * useQueryTokenizer — Parse prefix operators from the search input.
 *
 * Supports GitHub-style faceted filters:
 *   role:founder, company:stripe, location:london, industry:fintech,
 *   tag:investor, score:>80, updated:>6m
 *
 * A token becomes "locked" (a pill) when followed by a space.
 * Remaining free-text is forwarded to FTS5/vector search.
 *
 * @module hooks/useQueryTokenizer
 */
import { useMemo, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FacetField = 'role' | 'company' | 'location' | 'industry' | 'tag' | 'score' | 'updated';

export interface FacetFilter {
  field: FacetField;
  value: string;
  /** For score: and updated: operators (e.g., >80, <40) */
  operator?: '>' | '<';
}

export interface ParsedQuery {
  /** Locked facet pills */
  filters: FacetFilter[];
  /** Remaining free-text for FTS/vector search */
  freeText: string;
  /** Currently-being-typed filter prefix (no space yet → show autocomplete) */
  activePrefix: { field: FacetField; partial: string } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Valid facet field names */
const FACET_FIELDS: ReadonlySet<string> = new Set([
  'role', 'company', 'location', 'industry', 'tag', 'score', 'updated',
]);

/**
 * Regex to match completed facet tokens (followed by whitespace or EOL).
 * Captures: field name, colon, value, then whitespace.
 * Non-greedy value match stops at whitespace boundary.
 */
const COMPLETED_FACET_REGEX = /\b(role|company|location|industry|tag|score|updated):(\S+)\s/gi;

/**
 * Regex to detect an in-progress facet at the end of input.
 * e.g., "role:" or "role:eng" (no trailing space).
 */
const ACTIVE_PREFIX_REGEX = /\b(role|company|location|industry|tag|score|updated):(\S*)$/i;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Parse the raw search input into structured facet filters + free text.
 *
 * Usage:
 * ```ts
 * const { parsed, addFilter, removeFilter, buildSearchString } = useQueryTokenizer(search, setSearch);
 * ```
 */
export function useQueryTokenizer(
  rawInput: string,
  setRawInput: (value: string) => void,
) {
  /** Manually locked filters (from pills the user hasn't removed) */
  const lockedFiltersRef = useRef<FacetFilter[]>([]);

  const parsed = useMemo((): ParsedQuery => {
    const filters: FacetFilter[] = [...lockedFiltersRef.current];
    let remaining = rawInput;

    // Extract completed facet tokens (must have trailing space)
    const completedMatches: { full: string; field: string; value: string }[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(COMPLETED_FACET_REGEX.source, 'gi');

    while ((match = regex.exec(rawInput)) !== null) {
      completedMatches.push({
        full: match[0],
        field: match[1].toLowerCase(),
        value: match[2],
      });
    }

    // Move completed tokens to locked filters
    for (const cm of completedMatches) {
      if (!FACET_FIELDS.has(cm.field)) continue;

      const filter = parseFilterValue(cm.field as FacetField, cm.value);
      if (filter) {
        // Don't add duplicates
        if (!filters.some(f => f.field === filter.field && f.value === filter.value)) {
          filters.push(filter);
          lockedFiltersRef.current = [...lockedFiltersRef.current, filter];
        }
      }

      // Remove the token from the raw input
      remaining = remaining.replace(cm.full, '');
    }

    // Check for active prefix at end of input
    let activePrefix: ParsedQuery['activePrefix'] = null;
    const activePrefixMatch = remaining.match(ACTIVE_PREFIX_REGEX);
    if (activePrefixMatch) {
      activePrefix = {
        field: activePrefixMatch[1].toLowerCase() as FacetField,
        partial: activePrefixMatch[2] || '',
      };
      // Remove the active prefix from freeText
      remaining = remaining.replace(ACTIVE_PREFIX_REGEX, '');
    }

    return {
      filters,
      freeText: remaining.trim(),
      activePrefix,
    };
  }, [rawInput]);

  /** Add a filter manually (from autocomplete selection) */
  const addFilter = useCallback((filter: FacetFilter) => {
    // Don't add duplicates
    if (lockedFiltersRef.current.some(f => f.field === filter.field && f.value === filter.value)) {
      return;
    }
    lockedFiltersRef.current = [...lockedFiltersRef.current, filter];

    // Remove the active prefix from the raw input
    setRawInput(rawInput.replace(ACTIVE_PREFIX_REGEX, '').trim());
  }, [rawInput, setRawInput]);

  /** Remove a locked filter (pill dismiss) */
  const removeFilter = useCallback((index: number) => {
    lockedFiltersRef.current = lockedFiltersRef.current.filter((_, i) => i !== index);
    // Force re-parse by setting input to itself
    setRawInput(rawInput);
  }, [rawInput, setRawInput]);

  /** Remove the last locked filter (Backspace on empty input) */
  const removeLastFilter = useCallback(() => {
    if (lockedFiltersRef.current.length === 0) return false;
    lockedFiltersRef.current = lockedFiltersRef.current.slice(0, -1);
    setRawInput(rawInput);
    return true;
  }, [rawInput, setRawInput]);

  /** Reset all locked filters */
  const clearFilters = useCallback(() => {
    lockedFiltersRef.current = [];
  }, []);

  return {
    parsed,
    addFilter,
    removeFilter,
    removeLastFilter,
    clearFilters,
    hasFilters: lockedFiltersRef.current.length > 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a raw value string into a structured filter, handling operators for score/updated */
function parseFilterValue(field: FacetField, rawValue: string): FacetFilter | null {
  if (!rawValue) return null;

  if (field === 'score') {
    const opMatch = rawValue.match(/^([><]?)(\d+)$/);
    if (!opMatch) return null;
    return {
      field,
      value: opMatch[2],
      operator: (opMatch[1] as '>' | '<') || '>',
    };
  }

  if (field === 'updated') {
    const opMatch = rawValue.match(/^([><]?)(\d+[dwmy])$/i);
    if (!opMatch) return null;
    return {
      field,
      value: opMatch[2],
      operator: (opMatch[1] as '>' | '<') || '>',
    };
  }

  return { field, value: rawValue };
}
