/**
 * useContactListFilters — Search, filter, and sort logic for the contact list.
 *
 * Extracted from ContactList.tsx to isolate the data-transformation pipeline
 * from the UI layer. This hook manages three orthogonal filter dimensions:
 *
 * 1. **Search** — Debounced text input synced to URL `?q=` for permalink persistence.
 *    Uses `useDeferredValue` so the expensive scoring pass never blocks the input.
 * 2. **List filter** — URL-persisted via `?list=` param.
 * 3. **Sort** — Client-only state cycling through name↑ → name↓ → date↓ → date↑.
 *
 * @returns Filtered, sorted contacts + all state setters for the UI to wire up.
 */
import {
  useMemo,
  useState,
  useRef,
  useCallback,
  useEffect,
  useDeferredValue,
} from "react";
import { useSearchParams } from "react-router-dom";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { scoreContactMatch } from "../../../lib/contactMatch";
import type { Contact } from "../../../types";

type SortField = "name" | "date" | "score";
type SortDir = "asc" | "desc";

export function useContactListFilters(contacts: Contact[]) {
  const { preferences } = usePreferences();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL-persisted list filter ─────────────────────────────────────────
  const filterMode = searchParams.get("list") ?? "all";

  const setFilterMode = useCallback(
    (mode: string) => {
      setSearchParams(
        (prev) => {
          const params: Record<string, string> = {};
          if (mode !== "all") params.list = mode;
          // Preserve existing search query when changing filters
          const q = prev.get("q");
          if (q) params.q = q;
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ── Search: local state + debounced URL sync ──────────────────────────
  // The input is controlled by fast local state to prevent character-dropping.
  // URL params are updated after a 200ms debounce for permalink persistence.
  // The expensive contact filter uses useDeferredValue so it never blocks typing.
  const [inputValue, setInputValue] = useState(
    () => searchParams.get("q") ?? "",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether the URL change was initiated by our own typing (internal)
  // vs a browser back/forward navigation (external). Only external changes
  // should sync URL → local state — otherwise we overwrite characters typed
  // during the debounce window, causing the "character deletion" bug.
  const isInternalUpdateRef = useRef(false);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Sync URL → local state ONLY for external navigation events
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const urlQ = searchParams.get("q") ?? "";
    setInputValue((prev) => (prev === urlQ ? prev : urlQ));
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
            if (val) next.set("q", val);
            else next.delete("q");
            return next;
          },
          { replace: true },
        );
      }, 200);
    },
    [setSearchParams],
  );

  const setSearchQuery = useCallback(
    (val: string) => {
      setInputValue(val); // Instant — no lag
      syncQueryToUrl(val); // Debounced — URL persistence
    },
    [syncQueryToUrl],
  );

  // The actual query used for filtering — deferred so the heavy filter work
  // doesn't block the input's render cycle on a 400+ contact list.
  const searchQuery = useDeferredValue(inputValue);

  // ── Sort state ────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<SortField>(() => {
    if (preferences.listSort === "recent") return "date";
    if (preferences.listSort === "score") return "score";
    return "name";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    if (preferences.listSort === "recent" || preferences.listSort === "score")
      return "desc";
    return "asc";
  });

  const userHasChangedSort = useRef(false);

  useEffect(() => {
    if (!userHasChangedSort.current) {
      if (preferences.listSort === "recent") {
        setSortBy("date");
        setSortDir("desc");
      } else if (preferences.listSort === "score") {
        setSortBy("score");
        setSortDir("desc");
      } else {
        setSortBy("name");
        setSortDir("asc");
      }
    }
  }, [preferences.listSort]);

  const cycleSortMode = useCallback(() => {
    userHasChangedSort.current = true;
    if (sortBy === "name" && sortDir === "asc") {
      setSortDir("desc");
    } else if (sortBy === "name" && sortDir === "desc") {
      setSortBy("date");
      setSortDir("desc");
    } else if (sortBy === "date" && sortDir === "desc") {
      setSortDir("asc");
    } else if (sortBy === "date" && sortDir === "asc") {
      setSortBy("score");
      setSortDir("desc");
    } else if (sortBy === "score" && sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortBy("name");
      setSortDir("asc");
    }
  }, [sortBy, sortDir]);

  // ── Filtered + sorted contacts ────────────────────────────────────────
  const filteredContacts = useMemo(() => {
    let result = contacts.filter(
      (contact) => !contact.isArchived && !contact.isGhost,
    );

    // 1. Apply List Filter
    if (filterMode !== "all") {
      result = result.filter((contact) =>
        contact.lists?.some((l) => l.id === filterMode),
      );
    }

    // 2. Apply Smart Search (scored ranking)
    if (searchQuery.trim()) {
      result = result
        .map((contact) => ({
          contact,
          score: scoreContactMatch(contact, searchQuery),
        }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((c) => c.contact);
    }

    // 3. Apply Sort (only when not actively searching — search has its own score sort)
    if (!searchQuery.trim()) {
      result.sort((a, b) => {
        let cmp = 0;
        if (sortBy === "name") {
          cmp = (a.name || "").localeCompare(b.name || "");
        } else if (sortBy === "score") {
          cmp = (a.relationshipScore ?? 0) - (b.relationshipScore ?? 0);
        } else {
          // Date added — newer first by default (desc). ISO strings sort lexicographically without Date allocations.
          const da = a.addedAt || "";
          const db = b.addedAt || "";
          cmp = da.localeCompare(db);
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [contacts, searchQuery, filterMode, sortBy, sortDir]);

  return {
    // Search
    inputValue,
    searchQuery,
    setSearchQuery,
    // Filter
    filterMode,
    setFilterMode,
    // Sort
    sortBy,
    sortDir,
    cycleSortMode,
    // Results
    filteredContacts,
  };
}
