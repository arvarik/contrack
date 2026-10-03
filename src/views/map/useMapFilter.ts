/**
 * The map's filter. The text is the whole filter: its facets are the pills,
 * and the URL's `?q=` and a saved view hold the same text.
 *
 * @module views/map/useMapFilter
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { searchPlace } from "../../api/geo";
import { scoreContactMatch } from "../../lib/contactMatch";
import { isPastDay } from "../../../shared/dates";
import { formatFacet } from "../../../shared/facetQuery";
import { matchesFacet, type FacetFilter } from "../../../shared/searchFacets";
import type { MapContact } from "../../../shared/geo";
import {
  parseQuery,
  withFacet,
  withoutFacet,
} from "../../hooks/useQueryTokenizer";

/** A query that arrives whole ends in a space, so its last facet is a pill. */
const asTyped = (query: string) => (query.trim() ? `${query.trim()} ` : "");

const facetKey = (filter: FacetFilter) => formatFacet(filter).toLowerCase();
const placeKey = (filter: FacetFilter) => filter.value.trim().toLowerCase();
const PLACE_QUERY = ["geo", "place"] as const;

export function useMapFilter(contacts: MapContact[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const [rawInput, setRawInput] = useState(() => asTyped(urlQ));
  const [overdueOnly, setOverdueOnly] = useState(false);
  // The `q` the input and the URL last agreed on, so neither echoes the other.
  const syncedQ = useRef(urlQ);

  // A link, a saved view, or Back and Forward sets the input.
  useEffect(() => {
    if (urlQ === syncedQ.current) return;
    syncedQ.current = urlQ;
    setRawInput(asTyped(urlQ));
  }, [urlQ]);

  // Typing reaches the URL 200 ms after the last key, and leaves the view.
  useEffect(() => {
    const q = rawInput.trim();
    if (q === syncedQ.current) return;
    const timer = setTimeout(() => {
      syncedQ.current = q;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (q) next.set("q", q);
          else next.delete("q");
          next.delete("view");
          return next;
        },
        { replace: true },
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [rawInput, setSearchParams]);

  const parsed = useMemo(() => parseQuery(rawInput), [rawInput]);

  // A `near:` place is looked up as soon as its pill forms.
  const places = useMemo(
    () => [
      ...new Set(
        parsed.filters.filter((f) => f.field === "near").map(placeKey),
      ),
    ],
    [parsed.filters],
  );
  const lookups = useQueries({
    queries: places.map((place) => ({
      queryKey: [...PLACE_QUERY, place],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        searchPlace(place, signal),
      staleTime: Infinity,
      retry: false,
    })),
    combine: (results) =>
      results.map(({ data, error }) =>
        data ? { lat: data.lat, lng: data.lng } : error ? error.message : null,
      ),
  });

  const effectiveFilters = useMemo(
    () =>
      parsed.filters.map((filter): FacetFilter => {
        if (filter.field !== "near") return filter;
        const found = lookups[places.indexOf(placeKey(filter))];
        if (typeof found === "string")
          return { ...filter, error: found || "Nothing found for that place" };
        if (!found) return { ...filter, resolving: true };
        return { ...filter, point: { ...found, km: filter.km ?? 25 } };
      }),
    [parsed.filters, places, lookups],
  );

  const deferredFreeText = useDeferredValue(parsed.freeText);
  const filteredContacts = useMemo(() => {
    const now = new Date();
    return contacts.filter(
      (contact) =>
        (!overdueOnly || isPastDay(contact.nextFollowUpAt, now)) &&
        effectiveFilters.every((filter) => matchesFacet(contact, filter)) &&
        (!deferredFreeText || scoreContactMatch(contact, deferredFreeText) > 0),
    );
  }, [contacts, effectiveFilters, deferredFreeText, overdueOnly]);

  /** Add a facet in place of the one being typed, unless it is a pill. */
  const addFacet = useCallback(
    (filter: FacetFilter) => {
      const key = facetKey(filter);
      if (!parsed.filters.some((f) => facetKey(f) === key))
        setRawInput(withFacet(rawInput, filter));
    },
    [parsed.filters, rawInput],
  );

  const removeFacet = useCallback(
    (index: number) => {
      const filter = parsed.filters[index];
      if (filter) setRawInput(withoutFacet(rawInput, filter));
    },
    [parsed.filters, rawInput],
  );

  const queryClient = useQueryClient();
  /** Enter makes the last token a pill and asks again for a place not found. */
  const commit = useCallback(() => {
    if (rawInput.trim() && !/\s$/.test(rawInput)) setRawInput(`${rawInput} `);
    void queryClient.refetchQueries({
      queryKey: PLACE_QUERY,
      type: "active",
      predicate: (query) => query.state.status === "error",
    });
  }, [queryClient, rawInput]);

  const clearFilters = useCallback(() => {
    setOverdueOnly(false);
    setRawInput("");
  }, []);

  return {
    rawInput,
    setRawInput,
    parsed,
    effectiveFilters,
    filteredContacts,
    totalCount: contacts.length,
    matchCount: filteredContacts.length,
    hasActiveFilter: Boolean(rawInput.trim()) || overdueOnly,
    addFacet,
    removeFacet,
    commit,
    clearFilters,
    overdueOnly,
    setOverdueOnly,
  };
}

export type MapFilter = ReturnType<typeof useMapFilter>;
