import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import {
  useCreateContact,
  useContactNames,
  useAddInteraction,
  useSemanticSearch,
  useZeroState,
} from "../../api";
import { useDebounce } from "../../hooks/useDebounce";
import { useRecentContacts } from "../../hooks/useRecentContacts";
import { useSearchHistory } from "../../hooks/useSearchHistory";
import { useInstantSearch } from "../../hooks/useInstantSearch";
import {
  useQueryTokenizer,
  type FacetFilter,
} from "../../hooks/useQueryTokenizer";
import {
  Search,
  UserPlus,
  Briefcase,
  Building,
  Zap,
  Sparkles,
  HelpCircle,
  ArrowUpRight,
  ChevronsRight,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { ICON_BTN, KBD, TONE_WASH } from "../../lib/styles";
import { DURATION, EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { CLOSE_PALETTE_EVENT, OPEN_PALETTE_EVENT } from "../../lib/appEvents";
import type { SemanticMatch, ZeroStateInsight } from "../../types";
import {
  aiResultsHeading,
  getMode,
  GROUP_HEADING_DEFAULT,
  GROUP_HEADING_PRIMARY,
  ITEM_CURRENT,
  MATCH_BADGE,
  insightPath,
} from "./utils";
import { AIShimmerRow, AIResultCard } from "./AiComponents";
import { AiStarters } from "./AiStarters";
import { GoToGroup, NAV_ITEMS, ZeroStateView } from "./ZeroStateView";
import { LogMode } from "./LogMode";
import type { LogKind } from "./actionMode";
import { PaletteFooter, enterActionFor } from "./PaletteFooter";
import { ScoreDot, LastContactLine, StaleChip } from "./ContactMetaBadges";
import { useGroundingCapacity, useEnrichContact } from "../../api/enrichment";
import { ResultPeek } from "./ResultPeek";
import { SynthesisBar } from "./SynthesisBar";
import type { PeekContact } from "./ResultPeek";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { FacetPills } from "./FacetPills";
import { FacetAutocomplete } from "./FacetAutocomplete";
import { ActionSubMenu } from "./ActionSubMenu";
import { usePreferences } from "../../contexts/PreferencesContext";
import { NAMES } from "../../lib/names";

/** The icon at the start of the input, swapped when the mode changes. */
const ICON_SWAP = {
  initial: { scale: 0.5, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.5, opacity: 0 },
  transition: { duration: DURATION.fast, ease: EASE },
} as const;

/** The 11 px uppercase type of a badge or a status line in the list. */
const SMALL_CAPS = "text-[11px] font-bold uppercase tracking-[0.08em]";

/** The mode chips under the input. `active` is the look of the current one. */
const MODE_CHIPS = [
  {
    id: "normal",
    label: "Search",
    icon: Search,
    active: "bg-surface-container-high text-on-surface font-bold",
  },
  {
    id: "ai",
    label: "? Ask AI",
    icon: Sparkles,
    active: "bg-primary/10 text-on-primary-wash font-bold",
  },
  {
    id: "action",
    label: "> Log",
    icon: Zap,
    active: "bg-success/10 text-success font-bold",
  },
] as const;

/** No pills: one array, so a question without pills keeps one identity. */
const NO_FILTERS: FacetFilter[] = [];

// ─── Main component ───────────────────────────────────────────────────────────

export const CommandPalette = () => {
  const { preferences } = usePreferences();
  const aiAllowed = preferences.aiAssist;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // The highlighted row, by its cmdk value. The palette holds it, rather
  // than cmdk alone, so it can put the highlight back on a row when the row
  // it was on leaves the list (see the layout effect below).
  const [activeRow, setActiveRow] = useState("");
  // Escape hid the facet suggestions. Typing shows them again.
  const [facetMenuDismissed, setFacetMenuDismissed] = useState(false);
  /** The person moved the highlight since the query last changed. */
  const movedHighlightRef = useRef(false);
  const navigate = useNavigate();

  // ── Mode detection ──
  const mode = getMode(search);
  // AI debounce is intentionally longer than FTS. AI calls cost real money and
  // produce worse results for partial queries ("Who lives in Ame" is a
  // qualitatively different question than "Who lives in America"). 900ms is
  // roughly the median inter-key gap a user produces at the end of a thought,
  // so this fires when they've stopped composing rather than mid-word.
  const debouncedSearch = useDebounce(search, mode === "ai" ? 900 : 200);

  // ── Faceted filter tokenizer (Feature 5) ──
  const {
    parsed,
    addFilter,
    removeFilter,
    removeLastFilter,
    clearFilters,
    hasFilters,
  } = useQueryTokenizer(search, setSearch);

  // ── Instant search (Feature 8) — 0ms client filter + FTS handover ──
  const instantSearch = useInstantSearch(
    mode === "normal" ? parsed.freeText : "",
    parsed.filters,
    mode === "normal" && (!!parsed.freeText.trim() || hasFilters),
  );

  // ── Action Sub-Menu state (Feature 4) ──
  const [subMenuContactId, setSubMenuContactId] = useState<string | null>(null);
  const [subMenuContactName, setSubMenuContactName] = useState("");
  const [subMenuContactAvatar, setSubMenuContactAvatar] = useState<
    string | null
  >(null);

  // Hooks
  const { data: allContacts = [] } = useContactNames();
  const createContact = useCreateContact();
  const addInteraction = useAddInteraction();
  const semanticSearch = useSemanticSearch();

  // Zero-state hooks
  const { recentIds, recordVisit } = useRecentContacts();
  const searchHistory = useSearchHistory();
  const { data: zeroState } = useZeroState();

  // Both hooks return a FRESH object every render around methods that are
  // themselves stable useCallbacks. Effects and callbacks below depend on
  // the destructured methods, which satisfies exhaustive-deps without
  // re-firing on every render the way depending on the wrapper object would.
  const { mutate: runSemanticSearch, reset: resetSemanticSearch } =
    semanticSearch;
  const { addEntry } = searchHistory;

  // Enrichment hooks for StaleChip refresh action
  const { data: groundingCapacity } = useGroundingCapacity();
  const enrichContact = useEnrichContact();
  const [enrichingContactId, setEnrichingContactId] = useState<string | null>(
    null,
  );

  const handleRefreshContact = useCallback(
    (contactId: string) => {
      setEnrichingContactId(contactId);
      enrichContact.mutate(contactId, {
        onSettled: () => setEnrichingContactId(null),
      });
    },
    [enrichContact],
  );

  // ── Shift-to-peek state ──
  const [peekVisible, setPeekVisible] = useState(false);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Resolve recent contact IDs to full contact objects for rendering
  const recentContacts = useMemo(() => {
    if (!allContacts.length) return [];
    return recentIds
      .slice(0, 3)
      .map((id) => allContacts.find((c) => c.id === id))
      .filter((c): c is (typeof allContacts)[number] => !!c)
      .map((c) => ({
        id: c.id,
        name: c.name,
        avatarUrl: c.avatarUrl ?? null,
      }));
  }, [recentIds, allContacts]);

  // Track last fired query to prevent duplicate calls
  const prevAiQueryRef = useRef<string>("");

  // Track if a successful AI search was recorded for the current debounced query.
  // Without this, the recording effect re-fires on every keystroke while
  // `semanticSearch.isSuccess` stays true, leaving a trail of prefix entries
  // in "Recent searches" (e.g. "vent", "ventu", "ventur", "venture").
  const lastRecordedAiRef = useRef<string>("");

  // Derive the raw NL query from the ? prefix
  const aiQuery = mode === "ai" ? search.replace(/^\?+\s*/, "").trim() : "";

  // Debounced counterpart — used as the canonical "settled" query for
  // recording into history, so we only persist queries the user paused on.
  const debouncedAiQuery =
    mode === "ai" ? debouncedSearch.replace(/^\?+\s*/, "").trim() : "";

  // Derive AI results directly from mutation data (reactive, no extra
  // useState). Memoized so downstream memos/effects see a stable identity —
  // the bare conditional produced a new [] every render.
  const aiResults: SemanticMatch[] = useMemo(
    () =>
      mode === "ai" && semanticSearch.data ? semanticSearch.data.matches : [],
    [mode, semanticSearch.data],
  );
  const aiFallback: boolean = mode === "ai" && !!semanticSearch.data?.fallback;
  // A question of facets alone can hold thousands, and the list stops at 30.
  const aiTotal = semanticSearch.data?.total ?? aiResults.length;
  // The question `aiResults` answer, stamped on the results by the hook. The
  // synthesis brief reads this rather than the debounced input, which is a
  // different string for the whole of the debounce window.
  const aiAnsweredQuery: string =
    mode === "ai" ? (semanticSearch.data?.query ?? "") : "";

  // Build a lookup map from search results for O(1) peek resolution
  const resultMap = useMemo(() => {
    const map = new Map<string, PeekContact>();
    for (const c of instantSearch.results) {
      map.set(c.id, c as PeekContact);
    }
    if (mode === "ai") {
      for (const m of aiResults) {
        map.set(m.id, m as PeekContact);
      }
    }
    return map;
  }, [instantSearch.results, aiResults, mode]);

  // The pills go with the question. A pill that is removed, or added from
  // the autocomplete, changes the question the palette asks.
  const aiFilters = mode === "ai" ? parsed.filters : NO_FILTERS;
  const aiFilterKey = JSON.stringify(aiFilters);

  // Fire semantic search only when the *debounced* AI query settles.
  // Previously this read the live `aiQuery` but listed `debouncedSearch` as a
  // dependency, so the effect re-ran per keystroke and the debounce was a
  // no-op — every prefix the user typed hit the AI endpoint. Now the effect
  // genuinely waits for the user to pause before issuing a request, which
  // both reduces cost and dramatically improves answer quality (partial
  // queries embed/rerank poorly compared to fully-formed questions).
  useEffect(() => {
    if (
      !open ||
      mode !== "ai" ||
      debouncedAiQuery.length < 3 ||
      aiQuery !== debouncedAiQuery
    )
      return;
    const asked = `${debouncedAiQuery}\u0000${aiFilterKey}`;
    if (asked === prevAiQueryRef.current) return;
    prevAiQueryRef.current = asked;
    runSemanticSearch(debouncedAiQuery, aiFilters);
  }, [
    open,
    mode,
    aiQuery,
    debouncedAiQuery,
    runSemanticSearch,
    aiFilters,
    aiFilterKey,
  ]);

  // Reset mutation state when mode changes away from AI. Closing the palette
  // (Escape, the backdrop, ⌘K) leaves a question running, so the server
  // finishes the answer and caches it: asking again here or on Ask is
  // answered at once. Leaving AI mode while open cancels it.
  useEffect(() => {
    if (!open || mode !== "ai" || aiQuery.length < 3) {
      resetSemanticSearch(open);
      prevAiQueryRef.current = "";
    }
  }, [open, mode, aiQuery, resetSemanticSearch]);

  // Note: normal (FTS) searches are intentionally NOT recorded on debounce.
  // Debounced recording inevitably leaks prefixes ("Ri", "Ric", "Rich"...) as
  // the user types past each settled state. Instead we record the *committed*
  // query inside the contact result `onSelect` handler — matching the
  // industry-standard "save on selection" pattern (Google, Spotlight, Linear).
  // AI is different: an AI response is itself valuable even without a click,
  // so AI searches are recorded once the debounced query settles successfully.

  // Record successful AI searches to history.
  // Gated on the *debounced* query and a dedup ref so we record once per
  // settled query, not once per keystroke during typing.
  useEffect(() => {
    if (
      mode === "ai" &&
      semanticSearch.isSuccess &&
      aiResults.length > 0 &&
      debouncedAiQuery.length >= 3 &&
      debouncedAiQuery !== lastRecordedAiRef.current
    ) {
      lastRecordedAiRef.current = debouncedAiQuery;
      addEntry(`? ${debouncedAiQuery}`, "ai");
    }
  }, [
    semanticSearch.isSuccess,
    aiResults.length,
    debouncedAiQuery,
    mode,
    addEntry,
  ]);

  // Global ⌘K / Ctrl+K listener.
  // Always opens with a fresh empty input — matches Spotlight/Linear/Raycast.
  // The empty palette lists the recent searches, to pick from.
  // A touch screen has no ⌘K: the Network header's button sends
  // `OPEN_PALETTE_EVENT` (`openCommandPalette`), which only opens.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const openByEvent = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener(OPEN_PALETTE_EVENT, openByEvent);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_PALETTE_EVENT, openByEvent);
    };
  }, []);

  // The result row the actions menu opened from. The menu takes the rows'
  // place, and cmdk forgets the highlight when they go, so going back put
  // it on the top row: a second → then opened another contact's menu.
  const subMenuRowRef = useRef("");

  const openSubMenu = useCallback(
    (contact: { id: string; name: string; avatarUrl?: string | null }) => {
      subMenuRowRef.current = `${contact.id}${contact.name}`.trim();
      setSubMenuContactId(contact.id);
      setSubMenuContactName(contact.name);
      setSubMenuContactAvatar(contact.avatarUrl ?? null);
    },
    [],
  );

  const closeSubMenu = useCallback(() => {
    setSubMenuContactId(null);
    setSubMenuContactName("");
    setSubMenuContactAvatar(null);
    if (subMenuRowRef.current) {
      movedHighlightRef.current = true;
      setActiveRow(subMenuRowRef.current);
      subMenuRowRef.current = "";
    }
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch("");
    setActiveRow("");
    setFacetMenuDismissed(false);
    setPeekVisible(false);
    prevAiQueryRef.current = "";
    lastRecordedAiRef.current = "";
    clearFilters();
    subMenuRowRef.current = "";
    closeSubMenu();
  }, [clearFilters, closeSubMenu]);

  // Another shortcut that opens a dialog of its own closes the palette
  // first (`closeCommandPalette`). It used to send an Escape, which now
  // clears the input before it closes anything.
  useEffect(() => {
    window.addEventListener(CLOSE_PALETTE_EVENT, handleClose);
    return () => window.removeEventListener(CLOSE_PALETTE_EVENT, handleClose);
  }, [handleClose]);

  /**
   * Escape steps back one layer at a time. The facet suggestions and the
   * actions menu take their own Escape first. Then Escape clears the text
   * and the pills, and on an empty palette it closes. Radix asks here
   * before it closes the dialog, and a prevented Escape keeps it open.
   */
  const handleEscape = (e: KeyboardEvent) => {
    if (subMenuContactId) {
      e.preventDefault();
      closeSubMenu();
      return;
    }
    if (search !== "" || hasFilters) {
      e.preventDefault();
      setSearch("");
      clearFilters();
      setFacetMenuDismissed(false);
    }
  };

  const handleCreateContact = async () => {
    if (!search.trim()) return;
    try {
      const newContact = await createContact.mutateAsync({
        name: search.trim(),
        cadenceDays: preferences.defaultCadenceDays,
      });
      recordVisit(newContact.id);
      navigate(`/contact/${newContact.id}`);
      handleClose();
      toast.success(`Created contact ${newContact.name}`);
    } catch (e: unknown) {
      toast.error(
        `Failed to create contact: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // `>` mode: log what `LogMode` built.
  const handleLog = async ({
    kind,
    contact,
    text,
  }: {
    kind: LogKind;
    contact: { id: string; name: string };
    text: string;
  }) => {
    try {
      const titleMap: Record<LogKind, string> = {
        note: "Quick Note",
        call: "Phone Call logged",
        meeting: "Meeting summary",
        email: "Email sent",
      };
      await addInteraction.mutateAsync({
        contactId: contact.id,
        data: {
          type: kind,
          title: titleMap[kind],
          content: text,
          date: new Date().toISOString(),
        },
      });
      // Not kept as a recent search: it is not one. The note's text sat in
      // "Recent searches", and picking it filled the box to log it again.
      handleClose();
      toast.success(`Logged ${kind} for ${contact.name}`);
    } catch (e: unknown) {
      toast.error(
        `Failed to log interaction: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // ── Zero-state handlers ──

  const handleSelectContact = useCallback(
    (id: string) => {
      recordVisit(id);
      navigate(`/contact/${id}`);
      handleClose();
    },
    [navigate, handleClose, recordVisit],
  );

  const handleSelectHistory = useCallback(
    (query: string, entryMode?: string) => {
      if (entryMode === "notes") {
        const cleanQuery = query.replace(/^\s*\?\s*/, "").trim();
        navigate(`/search?mode=notes&q=${encodeURIComponent(cleanQuery)}`);
        handleClose();
        return;
      }
      setSearch(query);
    },
    [navigate, handleClose],
  );

  // Commit-on-selection recording for normal-mode contact picks.
  // This is the single place a contact-search query becomes a "recent" — no
  // debounced auto-record, so the user only sees queries they actually acted on.
  const handleSelectFtsContact = useCallback(
    (contactId: string) => {
      const trimmed = search.trim();
      if (trimmed.length >= 2) {
        searchHistory.addEntry(trimmed, "normal");
      }
      recordVisit(contactId);
      navigate(`/contact/${contactId}`);
      handleClose();
    },
    [search, searchHistory, recordVisit, navigate, handleClose],
  );

  const handleSelectInsight = useCallback(
    (insight: ZeroStateInsight) => {
      const path = insightPath(insight);
      if (path) {
        // A row that names a contact counts as a visit to it.
        if (insight.contact) recordVisit(insight.contact.id);
        navigate(path);
      }
      handleClose();
    },
    [navigate, handleClose, recordVisit],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
      handleClose();
    },
    [navigate, handleClose],
  );

  // ── Keys in the input ──
  //
  // ↑ and ↓ always move the highlight, which cmdk does. ↑ on an empty input
  // used to bring back the last search instead, so ↓ then ↑ in the empty
  // palette swapped its list for that search's results. The recent searches
  // are rows in the empty palette instead.

  const handleSearchInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // The actions menu took the key: ↑ and ↓ move its rows.
      if (e.defaultPrevented) return;
      // Backspace on empty input deletes the last facet pill
      if (e.key === "Backspace" && search === "" && hasFilters) {
        e.preventDefault();
        removeLastFilter();
        return;
      }
      // With text in the box, Home and End move the caret, as in any
      // field. Stopped here, cmdk's handler on the list never sees them.
      if ((e.key === "Home" || e.key === "End") && search !== "") {
        e.stopPropagation();
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        movedHighlightRef.current = true;
      }
    },
    [search, hasFilters, removeLastFilter],
  );

  // Is the input empty? (determines zero-state vs search results)
  const isEmptyInput = search.trim() === "" && !hasFilters;

  const facetMenuOpen = !!parsed.activePrefix && !facetMenuDismissed;
  const typedWords = parsed.freeText.trim().toLowerCase();
  /** The words are a destination's whole name: its row comes first. */
  const exactPage = NAV_ITEMS.some(
    (item) => item.label.toLowerCase() === typedWords,
  );
  /**
   * Offer a new contact by the typed name, unless somebody has it. Not
   * while the server may still find one, when nobody is listed yet, so a
   * quick Enter cannot make a duplicate.
   */
  const canCreate =
    typedWords.length > 0 &&
    !hasFilters &&
    !instantSearch.results.some(
      (c) => c.name?.trim().toLowerCase() === typedWords,
    ) &&
    (instantSearch.results.length > 0 || !instantSearch.isFtsLoading);

  // ── → key handler: enter sub-menu on focused result ──
  useEffect(() => {
    if (!open || subMenuContactId) return;

    const handleArrowRight = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight") return;
      // If the user is mid-edit inside the input, let → move the caret.
      // Only intercept once the caret has reached the end of the input — at
      // that point the user has finished typing and → naturally means "expand
      // into the action sub-menu for the highlighted result".
      const activeEl = document.activeElement as HTMLInputElement | null;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")
      ) {
        const end = activeEl.value.length;
        if (activeEl.selectionStart !== end || activeEl.selectionEnd !== end) {
          return;
        }
      }
      // Only in normal mode with results showing
      if (mode !== "normal" || isEmptyInput) return;

      // The highlighted row's value holds its contact's id.
      for (const contact of instantSearch.results) {
        if (activeRow.includes(contact.id)) {
          e.preventDefault();
          openSubMenu(contact);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleArrowRight);
    return () => window.removeEventListener("keydown", handleArrowRight);
  }, [
    open,
    subMenuContactId,
    mode,
    isEmptyInput,
    instantSearch.results,
    activeRow,
    openSubMenu,
  ]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      setFacetMenuDismissed(false);
      // Typing again closes the actions menu, for the new results.
      if (subMenuContactId) {
        subMenuRowRef.current = "";
        closeSubMenu();
      }
    },
    [subMenuContactId, closeSubMenu],
  );

  const modeChipsId = useId();

  /** A mode chip: its sign in front of the words, or none for Search. */
  const switchMode = (target: (typeof MODE_CHIPS)[number]["id"]) => {
    const words = search.replace(/^\s*[?>]\s*/, "");
    setSearch(
      target === "ai" ? `? ${words}` : target === "action" ? "> " : words,
    );
    setFacetMenuDismissed(false);
    if (subMenuContactId) {
      subMenuRowRef.current = "";
      closeSubMenu();
    }
    inputRef.current?.focus();
  };

  // A new query puts the highlight back on the top row, as cmdk does.
  useEffect(() => {
    movedHighlightRef.current = false;
  }, [search, parsed.filters]);

  /**
   * Keep one row highlighted, and keep it on the top row until the person
   * moves it.
   *
   * cmdk follows the highlighted row by its value. When the server's people
   * replace the instant ones, that row can leave the list, and cmdk then
   * highlights nothing, because it re-checks only the last row to unmount.
   * Enter did nothing until an arrow key picked a row. And when the server
   * ranks a row the instant list had on top lower down, the highlight went
   * with it, so Enter opened a row that was no longer on top.
   *
   * After every commit, once cmdk has given each row its value: the rows
   * come from a dozen sources. No list of dependencies on purpose. It
   * cannot loop: it saves the top row only when the highlight is elsewhere,
   * and the next commit finds it there.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const rows = list.querySelectorAll(
      '[cmdk-item]:not([aria-disabled="true"])',
    );
    if (!rows.length) return;
    const values = Array.from(rows, (row) => row.getAttribute("data-value"));
    const keep = movedHighlightRef.current && values.includes(activeRow);
    if (!keep && values[0] && values[0] !== activeRow) {
      setActiveRow(values[0]);
      // With its group's heading, which sits above it.
      list.scrollTop = 0;
    }
  });

  /**
   * The input names the highlighted row in `aria-activedescendant`, which a
   * screen reader announces. cmdk works it out before the rows show a new
   * highlight, so it was missing on open, after typing and after the
   * server's answer, until an arrow key was pressed. This follows the rows
   * themselves, and puts it back when cmdk writes a stale one.
   *
   * The list mounts a render after the palette opens, inside a portal, so
   * this runs after every render and watches the nodes it finds.
   */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const list = listRef.current;
    if (!input || !list) return;
    const sync = () => {
      const row = list.querySelector('[cmdk-item][aria-selected="true"]');
      if (!row?.id) input.removeAttribute("aria-activedescendant");
      else if (input.getAttribute("aria-activedescendant") !== row.id) {
        input.setAttribute("aria-activedescendant", row.id);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(list, {
      subtree: true,
      childList: true,
      attributeFilter: ["aria-selected"],
    });
    observer.observe(input, { attributeFilter: ["aria-activedescendant"] });
    return () => observer.disconnect();
  });

  // AI loading: mutation is pending AND query is long enough
  const isAiLoading = mode === "ai" && semanticSearch.isPending;

  /**
   * What a screen reader hears about the list (WCAG 4.1.3, as on the Ask
   * page): the count once it settles, not the instant rows that change
   * with each key, and the AI wait. The palette said nothing at all.
   */
  const peopleCount = (n: number) =>
    n === 0 ? "No people found" : `${n} ${n === 1 ? "person" : "people"} found`;
  const listSettled =
    !parsed.freeText.trim() ||
    (!instantSearch.isInstant && !instantSearch.isFtsLoading);
  const statusText = subMenuContactId
    ? ""
    : mode === "ai"
      ? aiQuery.length < 3
        ? ""
        : isAiLoading
          ? "Asking AI"
          : semanticSearch.isSuccess
            ? aiResults.length === 0
              ? "No matches found"
              : peopleCount(aiResults.length)
            : ""
      : mode === "normal" && !isEmptyInput && listSettled
        ? peopleCount(instantSearch.results.length)
        : "";

  // ── Shift-to-peek: the highlighted contact ──
  // A people row's value is its id and name, an AI row's `ai_<id>_<name>`.
  const peekContact = useMemo(() => {
    if (!open) return null;
    for (const [id, contact] of resultMap) {
      if (activeRow.includes(id)) return contact;
    }
    return null;
  }, [open, activeRow, resultMap]);

  // Shift-to-peek.
  // We originally bound this to Space, but the input always has focus inside
  // cmdk and Space is a valid text character, so the gesture could never fire
  // without inserting a space. Shift is a modifier that produces no text on
  // its own, so holding it while the input is focused is safe.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || e.repeat) return;
      if (!peekContact) return;
      if (!peekTimerRef.current) {
        peekTimerRef.current = setTimeout(() => {
          setPeekVisible(true);
        }, 200);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      if (peekTimerRef.current) {
        clearTimeout(peekTimerRef.current);
        peekTimerRef.current = null;
      }
      setPeekVisible(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (peekTimerRef.current) {
        clearTimeout(peekTimerRef.current);
        peekTimerRef.current = null;
      }
    };
  }, [open, peekContact]);

  return (
    <AnimatePresence>
      {open && (
        // cmdk's own `Command.Dialog` is these same Radix parts, with no way
        // to hear Escape before the dialog closes. Built here, the content
        // takes `onEscapeKeyDown`, which `handleEscape` needs.
        <Dialog.Root
          open
          onOpenChange={(v) => {
            if (!v) handleClose();
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay cmdk-overlay="" />
            <Dialog.Content
              aria-label="Global command palette"
              cmdk-dialog=""
              onEscapeKeyDown={handleEscape}
            >
              <Command
                label="Global command palette"
                value={activeRow}
                onValueChange={setActiveRow}
                // Every row arrives filtered: the people by the instant filter
                // or the server, the rest by this component. cmdk's own fuzzy
                // filter scores only a row's value against the whole input. It
                // hid every match on a company, a nickname or a phone number,
                // and it hid the row a one-line `>` action had built.
                shouldFilter={false}
                // Backdrop click-to-dismiss. The dialog content fills the viewport
                // (inset-0) which means Radix's built-in pointer-down-outside never
                // fires — there's nothing outside it. We close manually when the
                // click target is the backdrop itself (not the inner panel, which
                // stops propagation through its own click handlers / motion.div).
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) {
                    handleClose();
                  }
                }}
                className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-md bg-surface/40"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -20 }}
                  transition={{ duration: DURATION.fast, ease: EASE }}
                  // A press on the panel keeps the focus in the input, as a
                  // press on a row does. A heading or a gap took the focus,
                  // and then the page behind took the keys: `j` opened a
                  // contact and `n` a new contact under the open palette.
                  // A field, such as the note composer's, still takes it.
                  onMouseDownCapture={(e) => {
                    const target = e.target as HTMLElement;
                    if (
                      !target.closest(
                        "input, textarea, select, [contenteditable='true']",
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className="w-full max-w-2xl glass-panel shadow-2xl rounded-3xl overflow-hidden flex flex-col font-body"
                >
                  {/* ── Facet pills (Feature 5) ── */}
                  <FacetPills
                    filters={parsed.filters}
                    onRemove={removeFilter}
                  />

                  {/*
              Search input row: the mode icon, the input and the Escape hint.
              The input draws no ring, the one exception to the app's focus
              ring besides menu rows: the palette is a dialog with one field
              that has focus for as long as it is open, so a ring would never
              go away and would say nothing. Its caret and the open panel say
              where the typing goes.
            */}
                  <div className="flex items-center px-4 py-2 sm:py-4 bg-surface-container-low gap-3">
                    <AnimatePresence mode="wait">
                      {mode === "ai" ? (
                        <motion.div key="ai-icon" {...ICON_SWAP}>
                          <Sparkles
                            className={`w-5 h-5 text-primary ${isAiLoading ? "animate-pulse" : ""}`}
                          />
                        </motion.div>
                      ) : mode === "action" ? (
                        <motion.div key="action-icon" {...ICON_SWAP}>
                          <Zap className="w-5 h-5 text-success animate-pulse" />
                        </motion.div>
                      ) : (
                        <motion.div key="search-icon" {...ICON_SWAP}>
                          <Search className="w-5 h-5 text-on-surface-variant" />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <Command.Input
                      ref={inputRef}
                      value={search}
                      onValueChange={handleSearchChange}
                      onKeyDown={handleSearchInputKeyDown}
                      // The palette exists to be typed into the instant it opens.
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      // Short, so a phone shows it whole. The mode chips
                      // under it name `?` and `>`.
                      placeholder={
                        hasFilters
                          ? "Add more filters or search…"
                          : "Search people and pages…"
                      }
                      aria-describedby={modeChipsId}
                      className="flex-1 min-w-0 min-h-[44px] sm:min-h-0 bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant text-lg"
                    />
                    {/* Full ink: at half opacity it failed contrast. */}
                    <kbd className={cn(KBD, "pointer-coarse:hidden")}>Esc</kbd>
                    {/* A touch screen has no Esc key. */}
                    <button
                      type="button"
                      onClick={handleClose}
                      aria-label="Close command palette"
                      className={cn(
                        ICON_BTN,
                        "hidden pointer-coarse:inline-flex",
                      )}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/*
                    The modes, as buttons: a touch screen could reach `?`
                    and `>` only by switching keyboards, and a label that
                    looks like a tab but does nothing taught nobody. Each
                    puts its sign in front of the words already typed.
                  */}
                  <div
                    id={modeChipsId}
                    role="group"
                    aria-label="Mode"
                    className="flex items-center gap-1 px-3 py-1.5 bg-surface-container-low/50 text-[11px] border-t border-surface-container"
                  >
                    {MODE_CHIPS.map(({ id, label, icon: Icon, active }) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={mode === id}
                        onClick={() => switchMode(id)}
                        className={cn(
                          "hit-area state-layer flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors",
                          mode === id ? active : "text-on-surface-variant",
                        )}
                      >
                        <Icon className="w-3 h-3" aria-hidden="true" /> {label}
                      </button>
                    ))}
                  </div>

                  {/* ── Result list ── */}
                  {/* ── Facet autocomplete dropdown (Feature 5) ── */}
                  {parsed.activePrefix && !facetMenuDismissed && (
                    <FacetAutocomplete
                      field={parsed.activePrefix.field}
                      partial={parsed.activePrefix.partial}
                      // `addFilter` also clears the partial from the input. A second
                      // clear here used `\S*`, which stops at a space, so a quoted
                      // partial such as `industry:"Venture Cap` stayed in the box.
                      onSelect={addFilter}
                      // Escape hides the suggestions and leaves the text. It used
                      // to strip a bare `role:` and do nothing to `role:eng`, so
                      // the suggestions stayed and took every Escape after it.
                      onDismiss={() => setFacetMenuDismissed(true)}
                    />
                  )}

                  <Command.List
                    ref={listRef}
                    // The pointer moved the highlight: the layout effect above
                    // keeps it where the pointer put it.
                    onPointerMove={() => {
                      movedHighlightRef.current = true;
                    }}
                    className="max-h-[380px] overflow-y-auto p-2 scrollbar-hide"
                  >
                    {/* ═══════════════ ACTION SUB-MENU (Feature 4) ═══════════════ */}
                    {subMenuContactId && (
                      <ActionSubMenu
                        contactId={subMenuContactId}
                        contactName={subMenuContactName}
                        contactAvatarUrl={subMenuContactAvatar}
                        onViewProfile={() => {
                          recordVisit(subMenuContactId);
                          navigate(`/contact/${subMenuContactId}`);
                          handleClose();
                        }}
                        onCatchMeUp={() => {
                          recordVisit(subMenuContactId);
                          navigate(`/contact/${subMenuContactId}?brief=1`);
                          handleClose();
                        }}
                        onBack={closeSubMenu}
                        onClose={handleClose}
                        onReturnFocus={() => inputRef.current?.focus()}
                      />
                    )}

                    {/* ═══════════════ ZERO STATE (empty input, normal mode) ═══════════════ */}
                    {!subMenuContactId && mode === "normal" && isEmptyInput && (
                      <ZeroStateView
                        recentContacts={recentContacts}
                        historyEntries={searchHistory.recentDisplay}
                        insights={zeroState?.insights ?? []}
                        onSelectContact={handleSelectContact}
                        onSelectHistory={handleSelectHistory}
                        onSelectInsight={handleSelectInsight}
                        onNavigate={handleNavigate}
                      />
                    )}

                    {/* ═══════════════ AI MODE ═══════════════ */}
                    {!subMenuContactId && mode === "ai" && (
                      <>
                        {/* Empty / typing prompt */}
                        {/* Not `Command.Empty`: the starters are rows, and
                            cmdk shows an empty state only with no rows. */}
                        {aiQuery.length === 0 && (
                          <>
                            <div className="pt-6 pb-3 text-center text-sm text-on-surface-variant">
                              <Sparkles className="w-8 h-8 text-primary mx-auto mb-3" />
                              <p className="font-bold text-on-surface mb-1">
                                Ask AI
                              </p>
                              <p className="text-xs">
                                Ask anything about your network in plain English
                              </p>
                            </div>
                            <AiStarters onPick={(q) => setSearch(`? ${q}`)} />
                          </>
                        )}

                        {/* Short query — waiting for more input */}
                        {aiQuery.length > 0 && aiQuery.length < 3 && (
                          <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                            <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
                            <p className="text-xs">
                              Keep typing your question…
                            </p>
                          </Command.Empty>
                        )}

                        {/* Typed, not asked yet. The palette asks when the
                            typing stops, and the panel was blank until then. */}
                        {aiQuery.length >= 3 &&
                          !isAiLoading &&
                          !semanticSearch.isSuccess &&
                          !semanticSearch.isError && (
                            <div className="py-10 text-center text-xs text-on-surface-variant">
                              <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
                              Asks when you stop typing…
                            </div>
                          )}

                        {/*
                    Loading shimmer, for the whole wait. The first list the
                    server streams is a guess AI has not checked yet, so the
                    palette keeps it back and shows AI's answer only.
                  */}
                        {aiQuery.length >= 3 && isAiLoading && (
                          <div className="px-1 py-2 space-y-1">
                            <div
                              className={cn(
                                SMALL_CAPS,
                                "px-3 py-2 text-primary flex items-center gap-1.5",
                              )}
                            >
                              <Sparkles className="w-3 h-3 animate-pulse" />{" "}
                              Asking AI…
                            </div>
                            <AIShimmerRow delay={0} />
                            <AIShimmerRow delay={0.08} />
                            <AIShimmerRow delay={0.16} />
                          </div>
                        )}

                        {/* AI results */}
                        {aiQuery.length >= 3 &&
                          !isAiLoading &&
                          aiResults.length > 0 && (
                            <Command.Group
                              heading={aiResultsHeading(
                                aiFallback,
                                aiResults.length,
                                aiTotal,
                              )}
                              className={GROUP_HEADING_PRIMARY}
                            >
                              {aiFallback && (
                                <div className="flex items-start gap-1.5 px-3 pb-1 text-xs text-warning">
                                  <HelpCircle
                                    className="w-3.5 h-3.5 mt-px shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span>
                                    {aiAllowed
                                      ? "AI could not check these people this time. They match your words or their meaning"
                                      : "AI is off for your account. These people match your words or their meaning"}
                                  </span>
                                </div>
                              )}
                              {aiResults.map((match, i) => (
                                <AIResultCard
                                  key={match.id}
                                  match={match}
                                  index={i}
                                  isFallback={aiFallback}
                                  onSelect={() => {
                                    recordVisit(match.id);
                                    navigate(`/contact/${match.id}`);
                                    handleClose();
                                  }}
                                  hasGroundingCapacity={
                                    groundingCapacity?.hasCapacity ?? false
                                  }
                                  isEnriching={enrichContact.isPending}
                                  enrichingContactId={enrichingContactId}
                                  onRefresh={
                                    aiAllowed ? handleRefreshContact : undefined
                                  }
                                />
                              ))}
                            </Command.Group>
                          )}

                        {/* Synthesis executive brief (Feature 6) */}
                        {aiAllowed &&
                          aiQuery.length >= 3 &&
                          !isAiLoading &&
                          !aiFallback &&
                          aiResults.length > 0 && (
                            <SynthesisBar
                              query={aiAnsweredQuery}
                              contacts={aiResults}
                              resultCount={aiResults.length}
                              compact
                            />
                          )}

                        {/* The same question on the Ask Contrack page (Feature 11C) */}
                        {aiQuery.length >= 3 &&
                          !isAiLoading &&
                          aiResults.length > 0 && (
                            <div className="px-3 py-2 flex flex-wrap justify-end gap-x-4 gap-y-1">
                              <button
                                onClick={() => {
                                  navigate(
                                    `/search?mode=notes&q=${encodeURIComponent(aiQuery)}`,
                                  );
                                  handleClose();
                                }}
                                className="hit-area text-xs text-primary flex items-center gap-1 group"
                              >
                                Search notes
                                <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                              </button>
                              <button
                                onClick={() => {
                                  navigate(
                                    `/search?q=${encodeURIComponent(aiQuery)}`,
                                  );
                                  handleClose();
                                }}
                                className="hit-area text-xs text-primary flex items-center gap-1 group"
                              >
                                Open in {NAMES.ask.label}
                                <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                              </button>
                            </div>
                          )}

                        {/* No AI matches */}
                        {semanticSearch.isError && (
                          <div
                            role="alert"
                            className="px-4 py-3 text-sm text-error"
                          >
                            {semanticSearch.error?.message ||
                              "Search failed. Try again"}
                          </div>
                        )}
                        {aiQuery.length >= 3 &&
                          !isAiLoading &&
                          aiResults.length === 0 &&
                          !semanticSearch.isPending &&
                          semanticSearch.isSuccess && (
                            <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                              <Sparkles className="w-8 h-8 text-on-surface-variant/20 mx-auto mb-3" />
                              <p className="font-bold text-on-surface mb-1">
                                No matches found
                              </p>
                              <p className="text-xs">
                                Try rephrasing your query, or use the regular
                                search
                              </p>
                            </Command.Empty>
                          )}
                      </>
                    )}

                    {/* ═══════════════ LOG MODE (> prefix) ═══════════════ */}
                    {!subMenuContactId && mode === "action" && (
                      <LogMode
                        input={search}
                        contacts={allContacts}
                        recentContacts={recentContacts}
                        onFill={setSearch}
                        onLog={handleLog}
                      />
                    )}

                    {/* ═══════════════ NORMAL MODE (with search text or facets) ═══════════════ */}
                    {!subMenuContactId &&
                      mode === "normal" &&
                      !isEmptyInput && (
                        <>
                          {/* Not under the open facet values: they are
                              what to pick, not a search that found nothing. */}
                          {!facetMenuOpen && (
                            <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                              {instantSearch.isFtsLoading
                                ? "Searching…"
                                : "No people found"}
                            </Command.Empty>
                          )}

                          {exactPage && (
                            <GoToGroup
                              query={parsed.freeText}
                              onNavigate={handleNavigate}
                            />
                          )}

                          {instantSearch.results.length > 0 && (
                            <Command.Group
                              // No "instant" mark: it pulsed on every key,
                              // and nobody could say what it meant.
                              heading={
                                <span className="flex items-center gap-1.5">
                                  Contacts
                                  {hasFilters && (
                                    <span
                                      className={cn(SMALL_CAPS, "text-primary")}
                                    >
                                      filtered
                                    </span>
                                  )}
                                </span>
                              }
                              className={GROUP_HEADING_DEFAULT}
                            >
                              {instantSearch.results.map((contact) => (
                                <Command.Item
                                  key={contact.id}
                                  value={contact.id + contact.name}
                                  onSelect={() =>
                                    handleSelectFtsContact(contact.id)
                                  }
                                  className={cn(
                                    "flex items-start gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:text-on-primary-wash transition-colors text-on-surface group/result",
                                    ITEM_CURRENT,
                                  )}
                                >
                                  <img
                                    src={
                                      contact.avatarUrl ||
                                      fallbackAvatarUrl(contact.name)
                                    }
                                    alt=""
                                    className="w-8 h-8 mt-0.5 shrink-0 rounded-full bg-surface-container-highest object-cover"
                                  />
                                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-sm truncate">
                                        {contact.name}
                                      </span>
                                      <ScoreDot contact={contact} />
                                      {contact.approximate && (
                                        <span
                                          className={cn(
                                            TONE_WASH.primary,
                                            MATCH_BADGE,
                                          )}
                                        >
                                          Approximate
                                        </span>
                                      )}
                                    </div>
                                    {(contact.role || contact.company) && (
                                      <span className="text-xs text-on-surface-variant flex items-center gap-2 truncate">
                                        {contact.role && (
                                          <span className="flex items-center gap-1">
                                            <Briefcase className="w-3 h-3" />
                                            {contact.role}
                                          </span>
                                        )}
                                        {contact.company && (
                                          <span className="flex items-center gap-1">
                                            <Building className="w-3 h-3" />
                                            {contact.company}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    <LastContactLine
                                      lastContactedAt={contact.lastContactedAt}
                                    />
                                    <StaleChip
                                      contactId={contact.id}
                                      updatedAt={contact.updatedAt}
                                      hasGroundingCapacity={
                                        groundingCapacity?.hasCapacity ?? false
                                      }
                                      isEnriching={enrichContact.isPending}
                                      enrichingContactId={enrichingContactId}
                                      onRefresh={
                                        aiAllowed
                                          ? handleRefreshContact
                                          : undefined
                                      }
                                    />
                                  </div>
                                  {/* → action button: always visible on a touch screen, hover-reveal under a mouse from sm */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openSubMenu(contact);
                                    }}
                                    onMouseDown={(e) => e.preventDefault()}
                                    className="hit-area state-layer shrink-0 flex items-center gap-1 sm:opacity-0 sm:group-hover/result:opacity-50 sm:group-aria-selected/result:opacity-50 opacity-40 pointer-coarse:opacity-40 active:opacity-80 transition-opacity text-[11px] text-on-surface-variant self-center p-1.5 -mr-1 rounded-lg sm:p-0 sm:mr-0"
                                    aria-label={`Actions for ${contact.name}`}
                                  >
                                    <ChevronsRight className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                  </button>
                                </Command.Item>
                              ))}
                            </Command.Group>
                          )}

                          {/* Pages and Settings pages the words name:
                              "pulse" used to offer only a new contact. A
                              page named exactly comes before the people. */}
                          {!exactPage && (
                            <GoToGroup
                              query={parsed.freeText}
                              onNavigate={handleNavigate}
                            />
                          )}

                          {/* Last, and only when nobody has the name: an
                              approximate match hid it, so "Nancy Drew" could
                              not be made while "Nancy Drews" was a result.
                              Never with pills, which it would not keep. */}
                          {canCreate && (
                            <Command.Group
                              heading="Create"
                              className={GROUP_HEADING_DEFAULT}
                            >
                              <Command.Item
                                value={`create_${search}`}
                                onSelect={handleCreateContact}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2 rounded-xl cursor-default select-none transition-colors text-on-surface",
                                  ITEM_CURRENT,
                                )}
                              >
                                <div className="w-8 h-8 flex items-center justify-center bg-surface-container-highest rounded-full shrink-0">
                                  <UserPlus className="w-4 h-4 text-primary" />
                                </div>
                                <span className="text-sm truncate">
                                  Create contact{" "}
                                  <span className="font-bold">
                                    "{parsed.freeText.trim()}"
                                  </span>
                                </span>
                              </Command.Item>
                            </Command.Group>
                          )}
                        </>
                      )}
                  </Command.List>

                  <div
                    role="status"
                    aria-label="Palette status"
                    className="sr-only"
                  >
                    {statusText}
                  </div>

                  {/* ── Shift-to-peek, in a portal on the body ── */}
                  <ResultPeek contact={peekContact} visible={peekVisible} />

                  {/* ── Footer: the keys that work on this row ── */}
                  <PaletteFooter
                    enter={subMenuContactId ? null : enterActionFor(activeRow)}
                    canAct={
                      mode === "normal" && !subMenuContactId && !!peekContact
                    }
                    canPeek={!subMenuContactId && !!peekContact}
                    escape={
                      subMenuContactId
                        ? "back"
                        : search !== "" || hasFilters
                          ? "clear"
                          : "close"
                    }
                    tip={
                      isEmptyInput && mode === "normal" ? (
                        <span>
                          Filter with <code>tag:</code>, <code>role:</code> or{" "}
                          <code>company:</code>
                        </span>
                      ) : undefined
                    }
                  />
                </motion.div>
              </Command>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </AnimatePresence>
  );
};
