/**
 * Facet pills from a search input: a token such as `tag:vc` is a pill once a
 * space follows it. The palette's hook also keeps a pill whose text is gone.
 */
import { useMemo, useCallback, useState } from "react";
import {
  FACET_FIELD_PATTERN,
  QUOTED_VALUE_PATTERN,
  formatFacet,
  parseFilterValue,
} from "../../shared/facetQuery";

import type { FacetField, FacetFilter } from "../../shared/searchFacets";
export type { FacetField, FacetFilter } from "../../shared/searchFacets";

interface ParsedQuery {
  /** Locked facet pills */
  filters: FacetFilter[];
  /** The input without its finished facets: the words, and a facet being typed */
  rest: string;
  /** Remaining free-text for FTS/vector search */
  freeText: string;
  /** Currently-being-typed filter prefix (no space yet → show autocomplete) */
  activePrefix: { field: FacetField; partial: string } | null;
}

/**
 * A completed facet token: the field, the colon, the value, then whitespace.
 * The value is a quoted run, `industry:"Venture Capital"` (the map's insight
 * bars write that form), or a run with no space that does not start with a
 * quote. An open quote with no closing quote is still being typed, so it
 * never locks.
 */
const COMPLETED_FACET_REGEX = new RegExp(
  `\\b(${FACET_FIELD_PATTERN}):(${QUOTED_VALUE_PATTERN}|[^\\s"]\\S*)\\s`,
  "gi",
);

/**
 * A facet still being typed at the end of the input, such as "role:",
 * "role:eng" or `industry:"Venture Cap`.
 */
const ACTIVE_PREFIX_REGEX = new RegExp(
  `\\b(${FACET_FIELD_PATTERN}):("[^"]*"?\\S*|\\S*)$`,
  "i",
);

/** The typed value without its quotes, which the autocomplete matches on. */
const unquotePartial = (partial: string) =>
  partial.replace(/^"([^"]*)"?/, "$1");

const sameValue = (a: FacetFilter, b: FacetFilter) =>
  a.field === b.field && a.value === b.value;

/** Split the input into pills, free text and the facet being typed. */
export function parseQuery(
  rawInput: string,
  locked: readonly FacetFilter[] = [],
): ParsedQuery {
  const filters = [...locked];
  let remaining = rawInput;
  // The input less the facets that became pills. A facet the parser
  // rejects, such as `score:high`, stays in the box for the person to fix,
  // since it makes no pill.
  let rest = rawInput;
  for (const [full, field, value] of rawInput.matchAll(COMPLETED_FACET_REGEX)) {
    const filter = parseFilterValue(field.toLowerCase() as FacetField, value);
    if (filter && !filters.some((f) => sameValue(f, filter)))
      filters.push(filter);
    if (filter) rest = rest.replace(full, "");
    remaining = remaining.replace(full, "");
  }
  const active = remaining.match(ACTIVE_PREFIX_REGEX);
  return {
    filters,
    rest,
    freeText: remaining.replace(ACTIVE_PREFIX_REGEX, "").trim(),
    activePrefix: active
      ? {
          field: active[1].toLowerCase() as FacetField,
          partial: unquotePartial(active[2] || ""),
        }
      : null,
  };
}

/** The input with `filter` in place of the facet being typed, and a space. */
export function withFacet(input: string, filter: FacetFilter): string {
  const rest = input.replace(ACTIVE_PREFIX_REGEX, "").trimEnd();
  return `${rest ? `${rest} ` : ""}${formatFacet(filter)} `;
}

/** The input without the tokens that parse to `filter`. */
export function withoutFacet(input: string, filter: FacetFilter): string {
  const value = filter.value.toLowerCase();
  return input.replace(
    COMPLETED_FACET_REGEX,
    (full, field: string, raw: string) => {
      const typed = parseFilterValue(field.toLowerCase() as FacetField, raw);
      const typedValue = typed?.value.toLowerCase();
      const same =
        typed?.field === filter.field &&
        (typedValue === value || typedValue?.replace(/-/g, " ") === value);
      return same ? "" : full;
    },
  );
}

/**
 * The palette's pills: a pill stays until removed, even once its text is
 * gone. With `takeTyped`, a typed facet leaves the input when it becomes a
 * pill, as a picked value does, so `tag:vc ` does not show twice.
 */
export function useQueryTokenizer(
  rawInput: string,
  setRawInput: (value: string) => void,
  { takeTyped = false } = {},
) {
  /** Manually locked filters (from pills the user hasn't removed) */
  const [lockedFilters, setLockedFilters] = useState<FacetFilter[]>([]);

  const parsed = useMemo(
    () => parseQuery(rawInput, lockedFilters),
    [rawInput, lockedFilters],
  );

  // New tokens become locked pills, adjusted during render: the next render's
  // lengths match, which ends it.
  if (parsed.filters.length !== lockedFilters.length) {
    setLockedFilters(parsed.filters);
  }
  // During render, as above: the next render finds no finished facet.
  if (takeTyped && parsed.rest !== rawInput) {
    setRawInput(parsed.rest.trimStart());
  }

  /** Add a filter manually (from autocomplete selection) */
  const addFilter = useCallback(
    (filter: FacetFilter) => {
      if (lockedFilters.some((f) => sameValue(f, filter))) return;
      setLockedFilters((prev) =>
        prev.some((f) => sameValue(f, filter)) ? prev : [...prev, filter],
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
        const stripped = withoutFacet(rawInput, removed);
        if (stripped !== rawInput) setRawInput(stripped);
      }
    },
    [lockedFilters, rawInput, setRawInput],
  );

  /** Remove the last locked filter (Backspace on empty input) */
  const removeLastFilter = useCallback(() => {
    if (lockedFilters.length === 0) return false;
    const removed = lockedFilters[lockedFilters.length - 1];
    setLockedFilters((prev) => prev.slice(0, -1));
    const stripped = withoutFacet(rawInput, removed);
    if (stripped !== rawInput) setRawInput(stripped);
    return true;
  }, [lockedFilters, rawInput, setRawInput]);

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
