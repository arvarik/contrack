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
import { useMemo, useCallback, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FacetField =
  "role" | "company" | "location" | "industry" | "tag" | "score" | "updated";

export interface FacetFilter {
  field: FacetField;
  value: string;
  /** For score: and updated: operators (e.g., >80, <40) */
  operator?: ">" | "<";
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
  "role",
  "company",
  "location",
  "industry",
  "tag",
  "score",
  "updated",
]);

/**
 * Regex to match completed facet tokens (followed by whitespace or EOL).
 * Captures: field name, colon, value, then whitespace.
 * Non-greedy value match stops at whitespace boundary.
 */
const COMPLETED_FACET_REGEX =
  /\b(role|company|location|industry|tag|score|updated):(\S+)\s/gi;

/**
 * Regex to detect an in-progress facet at the end of input.
 * e.g., "role:" or "role:eng" (no trailing space).
 */
const ACTIVE_PREFIX_REGEX =
  /\b(role|company|location|industry|tag|score|updated):(\S*)$/i;

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
  const [lockedFilters, setLockedFilters] = useState<FacetFilter[]>([]);

  const parsed = useMemo((): ParsedQuery => {
    const filters: FacetFilter[] = [...lockedFilters];
    let remaining = rawInput;

    // Extract completed facet tokens (must have trailing space)
    const completedMatches: { full: string; field: string; value: string }[] =
      [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(COMPLETED_FACET_REGEX.source, "gi");

    while ((match = regex.exec(rawInput)) !== null) {
      completedMatches.push({
        full: match[0],
        field: match[1].toLowerCase(),
        value: match[2],
      });
    }

    // Merge completed tokens into the filter set (locked filters first)
    for (const cm of completedMatches) {
      if (!FACET_FIELDS.has(cm.field)) continue;

      const filter = parseFilterValue(cm.field as FacetField, cm.value);
      if (filter) {
        // Don't add duplicates
        if (
          !filters.some(
            (f) => f.field === filter.field && f.value === filter.value,
          )
        ) {
          filters.push(filter);
        }
      }

      // Remove the token from the raw input
      remaining = remaining.replace(cm.full, "");
    }

    // Check for active prefix at end of input
    let activePrefix: ParsedQuery["activePrefix"] = null;
    const activePrefixMatch = remaining.match(ACTIVE_PREFIX_REGEX);
    if (activePrefixMatch) {
      activePrefix = {
        field: activePrefixMatch[1].toLowerCase() as FacetField,
        partial: activePrefixMatch[2] || "",
      };
      // Remove the active prefix from freeText
      remaining = remaining.replace(ACTIVE_PREFIX_REGEX, "");
    }

    return {
      filters,
      freeText: remaining.trim(),
      activePrefix,
    };
  }, [rawInput, lockedFilters]);

  // Promote newly completed tokens into locked state. This is a render-phase
  // state adjustment (the React-sanctioned "derive state during render"
  // pattern): parsed.filters is always lockedFilters plus any new tokens, so
  // a length difference means new tokens were typed. The setState triggers an
  // immediate re-render where the lengths match, terminating the loop.
  if (parsed.filters.length !== lockedFilters.length) {
    setLockedFilters(parsed.filters);
  }

  /**
   * Remove any completed token text from the input that parses to the given
   * filter, so re-parsing doesn't immediately re-lock a removed pill.
   */
  const stripFilterToken = useCallback(
    (input: string, filter: FacetFilter): string => {
      const regex = new RegExp(COMPLETED_FACET_REGEX.source, "gi");
      return input.replace(regex, (full, field: string, value: string) => {
        const candidate = parseFilterValue(
          field.toLowerCase() as FacetField,
          value,
        );
        if (
          candidate &&
          candidate.field === filter.field &&
          candidate.value === filter.value
        ) {
          return "";
        }
        return full;
      });
    },
    [],
  );

  /** Add a filter manually (from autocomplete selection) */
  const addFilter = useCallback(
    (filter: FacetFilter) => {
      // Don't add duplicates
      if (
        lockedFilters.some(
          (f) => f.field === filter.field && f.value === filter.value,
        )
      ) {
        return;
      }
      setLockedFilters((prev) =>
        prev.some((f) => f.field === filter.field && f.value === filter.value)
          ? prev
          : [...prev, filter],
      );

      // Remove the active prefix from the raw input
      setRawInput(rawInput.replace(ACTIVE_PREFIX_REGEX, "").trim());
    },
    [lockedFilters, rawInput, setRawInput],
  );

  /** Remove a locked filter (pill dismiss) */
  const removeFilter = useCallback(
    (index: number) => {
      const removed = lockedFilters[index];
      setLockedFilters((prev) => prev.filter((_, i) => i !== index));
      if (removed) {
        const stripped = stripFilterToken(rawInput, removed);
        if (stripped !== rawInput) setRawInput(stripped);
      }
    },
    [lockedFilters, rawInput, setRawInput, stripFilterToken],
  );

  /** Remove the last locked filter (Backspace on empty input) */
  const removeLastFilter = useCallback(() => {
    if (lockedFilters.length === 0) return false;
    const removed = lockedFilters[lockedFilters.length - 1];
    setLockedFilters((prev) => prev.slice(0, -1));
    const stripped = stripFilterToken(rawInput, removed);
    if (stripped !== rawInput) setRawInput(stripped);
    return true;
  }, [lockedFilters, rawInput, setRawInput, stripFilterToken]);

  /** Reset all locked filters */
  const clearFilters = useCallback(() => {
    setLockedFilters([]);
  }, []);

  return {
    parsed,
    addFilter,
    removeFilter,
    removeLastFilter,
    clearFilters,
    hasFilters: parsed.filters.length > 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a raw value string into a structured filter, handling operators for score/updated */
function parseFilterValue(
  field: FacetField,
  rawValue: string,
): FacetFilter | null {
  if (!rawValue) return null;

  if (field === "score") {
    const opMatch = rawValue.match(/^([><]?)(\d+)$/);
    if (!opMatch) return null;
    return {
      field,
      value: opMatch[2],
      operator: (opMatch[1] as ">" | "<") || ">",
    };
  }

  if (field === "updated") {
    const opMatch = rawValue.match(/^([><]?)(\d+[dwmy])$/i);
    if (!opMatch) return null;
    return {
      field,
      value: opMatch[2],
      operator: (opMatch[1] as ">" | "<") || ">",
    };
  }

  return { field, value: rawValue };
}
