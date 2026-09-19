/**
 * useMapFilter — Filter state and execution for MapView.
 *
 * Synchronizes search query with the URL `?q=` parameter, integrates
 * `useQueryTokenizer` for facet pills (including `list:` and `near:`), resolves
 * `near:` coordinates via `/api/geo/search` on Enter, and filters MapContact
 * rows using `matchesFacet` and `scoreContactMatch`.
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
import { searchPlace } from "../../api/geo";
import { scoreContactMatch } from "../../lib/contactMatch";
import { matchesFacet, type FacetFilter } from "../../../shared/searchFacets";
import type { MapContact } from "../../../shared/geo";
import { useQueryTokenizer } from "../../hooks/useQueryTokenizer";

interface NearResolution {
  status: "resolving" | "resolved" | "error";
  point?: { lat: number; lng: number; km: number };
  error?: string;
}

export function useMapFilter(
  contacts: MapContact[],
  options?: {
    activeViewId?: string | null;
    onClearActiveView?: () => void;
    onFilterChange?: () => void;
  },
) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Local input state initialized from URL
  const [rawInput, setRawInputState] = useState(
    () => searchParams.get("q") ?? "",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInternalUpdateRef = useRef(false);

  // Near resolution cache by "value" or "value/km"
  const [nearResolutions, setNearResolutions] = useState<
    Record<string, NearResolution>
  >({});

  // Cleanup debounce on unmount
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Sync URL → local state for external navigation events (e.g. back/forward)
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const urlQ = searchParams.get("q") ?? "";
    setRawInputState((prev) => (prev === urlQ ? prev : urlQ));
  }, [searchParams]);

  // Debounce local state → URL params (200ms)
  const syncQueryToUrl = useCallback(
    (val: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        isInternalUpdateRef.current = true;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (val.trim()) {
              next.set("q", val);
              next.delete("view");
            } else {
              next.delete("q");
            }
            return next;
          },
          { replace: true },
        );
      }, 200);
    },
    [setSearchParams],
  );

  const setRawInput = useCallback(
    (val: string, optionsOverride?: { syncUrl?: boolean } | boolean) => {
      setRawInputState(val);
      const shouldSync =
        typeof optionsOverride === "boolean"
          ? optionsOverride
          : (optionsOverride?.syncUrl ?? true);
      if (!shouldSync) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        return;
      }
      (options?.onClearActiveView ?? options?.onFilterChange)?.();
      syncQueryToUrl(val);
    },
    [syncQueryToUrl, options],
  );

  // Tokenizer
  const tokenizer = useQueryTokenizer(rawInput, setRawInput);
  const { parsed, removeFilter } = tokenizer;

  // Resolve near filters
  const resolveNearFilters = useCallback(async () => {
    const nearFilters = parsed.filters.filter((f) => f.field === "near");
    if (nearFilters.length === 0) return;

    for (const filter of nearFilters) {
      const key = `${filter.value.toLowerCase()}/${filter.km ?? 25}`;
      const existing = nearResolutions[key];
      if (existing?.status === "resolved") continue;

      setNearResolutions((prev) => ({
        ...prev,
        [key]: { status: "resolving" },
      }));

      try {
        const result = await searchPlace(filter.value);
        setNearResolutions((prev) => ({
          ...prev,
          [key]: {
            status: "resolved",
            point: {
              lat: result.lat,
              lng: result.lng,
              km: filter.km ?? 25,
            },
          },
        }));
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Nothing found for that place";
        setNearResolutions((prev) => ({
          ...prev,
          [key]: {
            status: "error",
            error: message,
          },
        }));
      }
    }
  }, [parsed.filters, nearResolutions]);

  // Automatically resolve near filters that arrived from initial URL / bookmark
  const hasCheckedInitialNear = useRef(false);
  useEffect(() => {
    if (!hasCheckedInitialNear.current) {
      hasCheckedInitialNear.current = true;
      const hasNear = parsed.filters.some((f) => f.field === "near");
      if (hasNear) {
        resolveNearFilters();
      }
    }
  }, [parsed.filters, resolveNearFilters]);

  // Merge near resolutions into effective filters
  const effectiveFilters: FacetFilter[] = useMemo(() => {
    return parsed.filters.map((filter) => {
      if (filter.field !== "near") return filter;
      const key = `${filter.value.toLowerCase()}/${filter.km ?? 25}`;
      const res = nearResolutions[key];
      if (!res) return filter;
      if (res.status === "resolving") return { ...filter, resolving: true };
      if (res.status === "error") return { ...filter, error: res.error };
      if (res.status === "resolved" && res.point) {
        return { ...filter, point: res.point };
      }
      return filter;
    });
  }, [parsed.filters, nearResolutions]);

  // Deferred freeText so typing remains fluid
  const deferredFreeText = useDeferredValue(parsed.freeText);

  // Apply filters
  const filteredContacts = useMemo(() => {
    return contacts.filter((contact) => {
      // 1. Facets
      for (const filter of effectiveFilters) {
        if (!matchesFacet(contact, filter)) return false;
      }
      // 2. Free text scoring
      if (deferredFreeText) {
        if (scoreContactMatch(contact, deferredFreeText) <= 0) return false;
      }
      return true;
    });
  }, [contacts, effectiveFilters, deferredFreeText]);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setRawInputState("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    (options?.onClearActiveView ?? options?.onFilterChange)?.();
    isInternalUpdateRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("q");
        next.delete("view");
        return next;
      },
      { replace: true },
    );
    // Remove all locked filters
    for (let i = parsed.filters.length - 1; i >= 0; i--) {
      removeFilter(i);
    }
  }, [
    parsed.filters.length,
    removeFilter,
    setSearchParams,
    options?.onClearActiveView,
    options?.onFilterChange,
  ]);

  const hasActiveFilter = Boolean(
    rawInput.trim() || parsed.filters.length > 0 || parsed.freeText,
  );

  return {
    rawInput,
    setRawInput,
    tokenizer,
    effectiveFilters,
    filteredContacts,
    totalCount: contacts.length,
    matchCount: filteredContacts.length,
    hasActiveFilter,
    resolveNearFilters,
    clearFilters,
  };
}
