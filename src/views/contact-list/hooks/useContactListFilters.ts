/**
 * Search, filter and sort for the contact list.
 *
 * 1. Search: synced to `?q=` after a debounce, and deferred so scoring never
 *    blocks the input.
 * 2. Filter: `?list=` holds a list id, or `tracked` for the Tracked chip.
 *    `?tag=` is one more filter mode (`tag:investor`), so any chip replaces it.
 * 3. Sort: one of four choices, kept for the session.
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
import { parseFacetQuery } from "../../../../shared/facetQuery";
import { matchesFacet } from "../../../../shared/searchFacets";
import type { Contact } from "../../../types";

type SortField = "name" | "date";
type SortDir = "asc" | "desc";

type SortOption = "name-asc" | "name-desc" | "date-desc" | "date-asc";

interface SortChoice {
  id: SortOption;
  label: string;
  field: SortField;
  dir: SortDir;
}

/**
 * Name or date added, each both ways. No score order: every row shows its
 * score ring, and Pulse ranks by score. Labels are short because the menu's
 * trigger shows the current one.
 */
export const SORT_CHOICES: readonly SortChoice[] = [
  { id: "name-asc", label: "A to Z", field: "name", dir: "asc" },
  { id: "name-desc", label: "Z to A", field: "name", dir: "desc" },
  { id: "date-desc", label: "Newest", field: "date", dir: "desc" },
  { id: "date-asc", label: "Oldest", field: "date", dir: "asc" },
] as const;

function getSortChoice(sortBy: SortField, sortDir: SortDir): SortChoice {
  if (sortBy === "name") {
    return sortDir === "desc" ? SORT_CHOICES[1] : SORT_CHOICES[0];
  }
  return sortDir === "asc" ? SORT_CHOICES[3] : SORT_CHOICES[2];
}

const SESSION_SORT_KEY = "contrack.network_sort";

/** The `filterMode` of the Tracked chip. */
export const TRACKED_FILTER = "tracked";

/** The `filterMode` of one tag, `tag:investor`, read from `?tag=investor`. */
export const TAG_FILTER_PREFIX = "tag:";

/** The link to the Network list filtered to one tag. */
export const tagFilterPath = (tag: string) =>
  `/?tag=${encodeURIComponent(tag)}`;

/** Whether a contact has the tag, in any case. */
export const hasTag = (contact: Contact, tag: string) => {
  const wanted = tag.toLowerCase();
  return (contact.tags ?? []).some(
    (entry) => entry.tag.toLowerCase() === wanted,
  );
};

function getSessionSort(): SortOption | null {
  try {
    const raw = sessionStorage.getItem(SESSION_SORT_KEY);
    if (raw && SORT_CHOICES.some((c) => c.id === raw)) {
      return raw as SortOption;
    }
  } catch {
    // sessionStorage unavailable
  }
  return null;
}

function saveSessionSort(option: SortOption): void {
  try {
    sessionStorage.setItem(SESSION_SORT_KEY, option);
  } catch {
    // sessionStorage unavailable
  }
}

export function useContactListFilters(contacts: Contact[]) {
  const { preferences } = usePreferences();
  const [searchParams, setSearchParams] = useSearchParams();

  const tag = searchParams.get("tag");
  const filterMode = tag
    ? `${TAG_FILTER_PREFIX}${tag}`
    : (searchParams.get("list") ?? "all");

  const setFilterMode = useCallback(
    (mode: string) => {
      setSearchParams(
        (prev) => {
          const params: Record<string, string> = {};
          if (mode.startsWith(TAG_FILTER_PREFIX)) {
            params.tag = mode.slice(TAG_FILTER_PREFIX.length);
          } else if (mode !== "all") params.list = mode;
          const q = prev.get("q");
          if (q) params.q = q;
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // The input reads local state, so no keystroke drops. The URL follows
  // after 200 ms.
  const [inputValue, setInputValue] = useState(
    () => searchParams.get("q") ?? "",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True when our own typing changed the URL. Only an outside change (Back,
  // Forward) syncs the URL into the input, or it would erase letters typed
  // during the debounce.
  const isInternalUpdateRef = useRef(false);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const urlQ = searchParams.get("q") ?? "";
    setInputValue((prev) => (prev === urlQ ? prev : urlQ));
  }, [searchParams]);

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
      setInputValue(val);
      syncQueryToUrl(val);
    },
    [syncQueryToUrl],
  );

  // Deferred, so filtering 400+ contacts does not block the input.
  const searchQuery = useDeferredValue(inputValue);

  const [sortBy, setSortBy] = useState<SortField>(() => {
    const saved = getSessionSort();
    if (saved) {
      const match = SORT_CHOICES.find((c) => c.id === saved);
      if (match) return match.field;
    }
    if (preferences.listSort === "recent") return "date";
    return "name";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const saved = getSessionSort();
    if (saved) {
      const match = SORT_CHOICES.find((c) => c.id === saved);
      if (match) return match.dir;
    }
    if (preferences.listSort === "recent") return "desc";
    return "asc";
  });

  const userHasChangedSort = useRef(Boolean(getSessionSort()));

  useEffect(() => {
    if (!userHasChangedSort.current && !getSessionSort()) {
      if (preferences.listSort === "recent") {
        setSortBy("date");
        setSortDir("desc");
      } else {
        setSortBy("name");
        setSortDir("asc");
      }
    }
  }, [preferences.listSort]);

  const setSortOption = useCallback((option: SortOption) => {
    userHasChangedSort.current = true;
    saveSessionSort(option);
    const choice = SORT_CHOICES.find((c) => c.id === option);
    if (!choice) return;
    setSortBy(choice.field);
    setSortDir(choice.dir);
  }, []);

  const filteredContacts = useMemo(() => {
    let result = contacts.filter(
      (contact) => !contact.isArchived && !contact.isGhost,
    );

    if (filterMode === TRACKED_FILTER) {
      result = result.filter((contact) => contact.isTracked);
    } else if (filterMode.startsWith(TAG_FILTER_PREFIX)) {
      const wanted = filterMode.slice(TAG_FILTER_PREFIX.length);
      result = result.filter((contact) => hasTag(contact, wanted));
    } else if (filterMode !== "all") {
      result = result.filter((contact) =>
        contact.lists?.some((l) => l.id === filterMode),
      );
    }

    // Facets first (`/?q=missing:company`), then the free text. `near:`
    // needs a geocoder, so only the palette applies it.
    const { filters, freeText } = parseFacetQuery(searchQuery);
    const facets = filters.filter((f) => f.field !== "near");
    if (facets.length > 0) {
      result = result.filter((contact) =>
        facets.every((f) => matchesFacet(contact, f)),
      );
    }
    if (freeText.trim()) {
      result = result
        .map((contact) => ({
          contact,
          score: scoreContactMatch(contact, freeText),
        }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((c) => c.contact);
    }

    // A text search keeps its score order.
    if (!freeText.trim()) {
      result.sort((a, b) => {
        let cmp = 0;
        if (sortBy === "name") {
          cmp = (a.name || "").localeCompare(b.name || "");
        } else {
          // ISO strings sort as text.
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
    inputValue,
    searchQuery,
    setSearchQuery,
    filterMode,
    setFilterMode,
    sortBy,
    sortDir,
    currentSort: getSortChoice(sortBy, sortDir),
    setSortOption,
    filteredContacts,
  };
}
