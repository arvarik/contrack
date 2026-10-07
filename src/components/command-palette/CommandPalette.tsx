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
import { useRecentContacts } from "../../hooks/useRecentContacts";
import { useSearchHistory } from "../../hooks/useSearchHistory";
import { useInstantSearch } from "../../hooks/useInstantSearch";
import {
  useQueryTokenizer,
  type FacetFilter,
} from "../../hooks/useQueryTokenizer";
import { ListFilter, Search, Sparkles, X, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { ICON_BTN, KBD } from "../../lib/styles";
import { DURATION, EASE } from "../../lib/motion";
import { cn, errorText } from "../../lib/utils";
import { CLOSE_PALETTE_EVENT, OPEN_PALETTE_EVENT } from "../../lib/appEvents";
import type { SemanticMatch, ZeroStateInsight } from "../../types";
import { formatFacet } from "../../../shared/facetQuery";
import { getMode, insightPath, looksLikeQuestion } from "./utils";
import { AiMode } from "./AiMode";
import { useAiSetup } from "../../hooks/useAiSetup";
import { NAV_ITEMS, ZeroStateView } from "./ZeroStateView";
import { LogMode } from "./LogMode";
import { parseLogInput, type LogKind } from "./actionMode";
import { INTERACTION_LABELS } from "../../lib/interactionKinds";
import { InlineNoteComposer } from "./InlineNoteComposer";
import { PaletteFooter, enterActionFor } from "./PaletteFooter";
import { PeopleMode } from "./PeopleMode";
import { FilterFields } from "./FilterFields";
import { ResultPeek } from "./ResultPeek";
import type { PeekContact } from "./ResultPeek";
import { FacetPills } from "./FacetPills";
import { FacetAutocomplete } from "./FacetAutocomplete";
import { ActionSubMenu } from "./ActionSubMenu";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useCloseRequest } from "../../hooks/useCloseRequest";
import { NO_AUTOCORRECT } from "../ui/SearchField";

/** The icon at the start of the input, swapped when the mode changes. */
const ICON_SWAP = {
  initial: { scale: 0.5, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.5, opacity: 0 },
  transition: { duration: DURATION.fast, ease: EASE },
} as const;

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

export const CommandPalette = () => {
  const { preferences } = usePreferences();
  const aiAllowed = preferences.aiAssist;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // The highlighted row, by its cmdk value, held here so the highlight can
  // return when its row leaves the list (see the layout effect below).
  const [activeRow, setActiveRow] = useState("");
  // Escape hid the facet suggestions. Typing shows them again.
  const [facetMenuDismissed, setFacetMenuDismissed] = useState(false);
  // "Filter by": the facet fields as rows, from the Filter chip.
  const [facetPicker, setFacetPicker] = useState(false);
  // Escape once on a typed `>` note: the next one discards it.
  const [discardArmed, setDiscardArmed] = useState(false);
  // The words the `> Log` chip carried over, read as a name (`LogMode`).
  const [logNameHint, setLogNameHint] = useState("");
  // `>` on a touch screen: the composer for the contact it picked.
  const [logComposer, setLogComposer] = useState<{
    kind: LogKind;
    contact: { id: string; name: string };
    text: string;
  } | null>(null);
  /** The person moved the highlight since the query last changed. */
  const movedHighlightRef = useRef(false);
  /** The pointer, not a key, moved it last: the list does not scroll. */
  const pointerMovedRef = useRef(false);
  const routerNavigate = useNavigate();

  const mode = getMode(search);

  // Typed facets become pills
  const {
    parsed,
    addFilter,
    removeFilter,
    removeLastFilter,
    clearFilters,
    hasFilters,
  } = useQueryTokenizer(search, setSearch, { takeTyped: mode === "normal" });

  // Instant search: a filter in the browser, then the server's FTS answer
  const instantSearch = useInstantSearch(
    mode === "normal" ? parsed.freeText : "",
    parsed.filters,
    mode === "normal" && (!!parsed.freeText.trim() || hasFilters),
  );

  // The pills and the words, as one query: what a recent search keeps, and
  // what "Show all in Network" opens. Typed facets leave the box as pills.
  const fullQuery = [...parsed.filters.map(formatFacet), parsed.freeText.trim()]
    .filter(Boolean)
    .join(" ");

  // The actions menu
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

  // Both hooks return a new object each render around stable methods, so
  // the effects below depend on the methods.
  const { mutate: runSemanticSearch, reset: resetSemanticSearch } =
    semanticSearch;
  const { addEntry } = searchHistory;

  // Why AI cannot answer, while the palette is in `?` mode.
  const aiSetup = useAiSetup("ask", open && mode === "ai");

  // Shift peeks
  const [peekVisible, setPeekVisible] = useState(false);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The scroll area: the list, and the notes above and below it.
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  // The question and the pills last asked, as one key. The answer shown is
  // for this, and a different question waits for Enter.
  const [askedKey, setAskedKey] = useState("");

  // The question already saved to Recent, so an answer is saved once.
  const lastRecordedAiRef = useRef<string>("");

  // Derive the raw NL query from the ? prefix
  const aiQuery = mode === "ai" ? search.replace(/^\?+\s*/, "").trim() : "";

  // Memoized, so the memos and effects below see a stable identity.
  const aiResults: SemanticMatch[] = useMemo(
    () =>
      mode === "ai" && semanticSearch.data ? semanticSearch.data.matches : [],
    [mode, semanticSearch.data],
  );
  const aiFallback: boolean = mode === "ai" && !!semanticSearch.data?.fallback;
  // A question of facets alone can hold thousands, and the list stops at 30.
  const aiTotal = semanticSearch.data?.total ?? aiResults.length;
  // The question `aiResults` answer, stamped by the hook. The synthesis
  // brief reads this, not the debounced input, which lags the answer.
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

  // The highlighted contact: Shift peeks at it, → opens its actions. A
  // people row's value is its id and name, an AI row's `ai_<id>_<name>`.
  const peekContact = useMemo(() => {
    if (!open) return null;
    for (const [id, contact] of resultMap) {
      if (activeRow.includes(id)) return contact;
    }
    return null;
  }, [open, activeRow, resultMap]);

  // The pills go with the question. A pill that is removed, or added from
  // the autocomplete, changes the question the palette asks.
  const aiFilters = mode === "ai" ? parsed.filters : NO_FILTERS;
  const aiFilterKey = JSON.stringify(aiFilters);

  /**
   * Asks AI only on purpose: Enter on an "Ask AI" row, a starter or a recent
   * question. Asking on a typing pause would send half a question.
   */
  const askAi = useCallback(
    (question: string, filters: FacetFilter[]) => {
      const q = question.trim();
      if (q.length < 3) return;
      setAskedKey(`${q}\u0000${JSON.stringify(filters)}`);
      runSemanticSearch(q, filters);
    },
    [runSemanticSearch],
  );

  // Typed, or the pills changed, since the last question: Enter asks.
  const aiPending =
    mode === "ai" &&
    aiQuery.length >= 3 &&
    `${aiQuery}\u0000${aiFilterKey}` !== askedKey;
  // The question on screen failed. Its error shows with an Ask row, so
  // Enter can try again.
  const askFailed = mode === "ai" && !aiPending && semanticSearch.isError;

  // Leaving AI mode while open cancels the question. Closing the palette
  // (Escape, the backdrop, ⌘K) leaves it running, so the server finishes
  // and caches the answer: asking again here or on Ask is answered at once.
  useEffect(() => {
    if (!open || mode !== "ai" || aiQuery.length < 3) {
      resetSemanticSearch(open);
      setAskedKey("");
    }
  }, [open, mode, aiQuery, resetSemanticSearch]);

  // Save an answered question to Recent, once. Normal searches are saved
  // only when a person picks a result (`handleSelectFtsContact`).
  useEffect(() => {
    const answered = semanticSearch.data?.query ?? "";
    if (
      mode === "ai" &&
      semanticSearch.isSuccess &&
      aiResults.length > 0 &&
      answered &&
      answered !== lastRecordedAiRef.current
    ) {
      lastRecordedAiRef.current = answered;
      addEntry(`? ${answered}`, "ai");
    }
  }, [
    semanticSearch.isSuccess,
    semanticSearch.data?.query,
    aiResults.length,
    mode,
    addEntry,
  ]);

  // What had the focus before the palette opened, to give it back on close.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Leaving for another page: the opener belongs to the page left behind,
  // so the focus does not go back to it.
  const navigate = useCallback(
    (path: string) => {
      returnFocusRef.current = null;
      routerNavigate(path);
    },
    [routerNavigate],
  );
  const openRef = useRef(open);
  openRef.current = open;
  // The latest `handleClose`, for the key listener below, which binds once.
  const closeRef = useRef<() => void>(() => {});

  // ⌘K / Ctrl+K opens the palette with an empty box and closes it as Escape
  // does on an empty box. A touch screen has no ⌘K: each page header's
  // button sends `OPEN_PALETTE_EVENT` (`openCommandPalette`).
  useEffect(() => {
    const openPalette = () => {
      if (openRef.current) return;
      const focused = document.activeElement;
      returnFocusRef.current =
        focused instanceof HTMLElement && focused !== document.body
          ? focused
          : null;
      setOpen(true);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (openRef.current) closeRef.current();
        else openPalette();
      }
    };
    document.addEventListener("keydown", down);
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette);
    };
  }, []);

  // The row the actions menu opened from. cmdk forgets the highlight when
  // the menu replaces the rows, so going back restores it from here.
  const subMenuRowRef = useRef("");

  const openSubMenu = useCallback(
    (
      contact: { id: string; name: string; avatarUrl?: string | null },
      row = `${contact.id}${contact.name}`.trim(),
    ) => {
      subMenuRowRef.current = row;
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
    // "Back to results" goes away with the menu, so the input takes the focus.
    inputRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch("");
    setActiveRow("");
    setFacetMenuDismissed(false);
    setFacetPicker(false);
    setDiscardArmed(false);
    setLogComposer(null);
    setLogNameHint("");
    setPeekVisible(false);
    lastRecordedAiRef.current = "";
    clearFilters();
    subMenuRowRef.current = "";
    closeSubMenu();
  }, [clearFilters, closeSubMenu]);

  closeRef.current = handleClose;

  // Another shortcut that opens a dialog of its own closes the palette
  // first (`closeCommandPalette`). An Escape would only clear the input.
  useEffect(() => {
    window.addEventListener(CLOSE_PALETTE_EVENT, handleClose);
    return () => window.removeEventListener(CLOSE_PALETTE_EVENT, handleClose);
  }, [handleClose]);

  /**
   * Escape steps back one layer at a time, and so does a phone's Back. The
   * facet values and the actions menu take their own Escape first. Then it
   * closes "Filter by", asks once before it discards a typed `>` note,
   * clears the text and the pills, and says false on an empty palette,
   * which then closes. Back reaches no key handler, so it closes the facet
   * values and the actions menu here.
   */
  const stepBack = (fromBack = false): boolean => {
    if (fromBack && facetMenuOpen) {
      setFacetMenuDismissed(true);
      return true;
    }
    if (subMenuContactId) {
      closeSubMenu();
      return true;
    }
    if (logComposer) {
      setLogComposer(null);
      return true;
    }
    if (facetPicker) {
      setFacetPicker(false);
      return true;
    }
    const log = mode === "action" ? parseLogInput(search) : null;
    if (log?.step === "text" && log.text && !discardArmed) {
      setDiscardArmed(true);
      return true;
    }
    if (search !== "" || hasFilters) {
      setSearch("");
      clearFilters();
      setFacetMenuDismissed(false);
      setDiscardArmed(false);
      setLogNameHint("");
      // Back to the box, so the next words land there.
      inputRef.current?.focus();
      return true;
    }
    return false;
  };

  /**
   * cmdk runs the highlighted row on any Enter inside the palette. A focused
   * button (a mode chip, a pill's ×, a link) runs itself instead: cmdk skips
   * a prevented key.
   */
  const handleRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.target === inputRef.current) return;
    const control = (e.target as HTMLElement).closest<HTMLElement>(
      "button, a[href], [role='button']",
    );
    if (!control || control.hasAttribute("cmdk-item")) return;
    e.preventDefault();
    control.click();
  };

  // Radix asks here before it closes the dialog: a prevented Escape keeps
  // it open.
  const handleEscape = (e: KeyboardEvent) => {
    if (stepBack()) e.preventDefault();
  };

  // Android's Back steps back inside the palette, not out of the page.
  useCloseRequest(open, () => {
    if (!stepBack(true)) handleClose();
  });

  const handleCreateContact = async () => {
    const name = parsed.freeText.trim();
    if (!name) return;
    try {
      const newContact = await createContact.mutateAsync({
        name,
        cadenceDays: preferences.defaultCadenceDays,
      });
      recordVisit(newContact.id);
      navigate(`/contact/${newContact.id}`);
      handleClose();
      toast.success(`Created contact ${newContact.name}`);
    } catch (e: unknown) {
      toast.error(`Could not create the contact: ${errorText(e)}`);
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
      await addInteraction.mutateAsync({
        contactId: contact.id,
        data: {
          type: kind,
          title: INTERACTION_LABELS[kind],
          content: text,
          date: new Date().toISOString(),
        },
      });
      // Not kept as a recent search: it is not one.
      handleClose();
      toast.success(`Logged ${kind} for ${contact.name}`);
    } catch (e: unknown) {
      toast.error(`Could not log the interaction: ${errorText(e)}`);
    }
  };

  // Zero-state handlers

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
      // A question picked again is asked again.
      if (query.trim().startsWith("?"))
        askAi(query.replace(/^\s*\?\s*/, ""), []);
    },
    [navigate, handleClose, askAi],
  );

  // The one place a people search becomes a recent search: when a person
  // picks a result.
  const handleSelectFtsContact = useCallback(
    (contactId: string) => {
      if (fullQuery.length >= 2) searchHistory.addEntry(fullQuery, "normal");
      recordVisit(contactId);
      navigate(`/contact/${contactId}`);
      handleClose();
    },
    [fullQuery, searchHistory, recordVisit, navigate, handleClose],
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

  // Keys in the input. ↑ and ↓ always move the highlight (cmdk does that).

  const handleSearchInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      pointerMovedRef.current = false;
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
    // Nobody is called "who works at Stripe".
    !looksLikeQuestion(typedWords) &&
    !instantSearch.results.some(
      (c) => c.name?.trim().toLowerCase() === typedWords,
    ) &&
    (instantSearch.results.length > 0 || !instantSearch.isFtsLoading);

  // → opens the highlighted result's actions
  useEffect(() => {
    if (!open || subMenuContactId) return;

    const handleArrowRight = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight") return;
      // → moves the caret until it reaches the end of the input. There it
      // opens the highlighted result's actions.
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
      // A person's row, in the people search or in AI's answer.
      if (!peekContact) return;
      e.preventDefault();
      openSubMenu(peekContact, activeRow);
    };

    window.addEventListener("keydown", handleArrowRight);
    return () => window.removeEventListener("keydown", handleArrowRight);
  }, [open, subMenuContactId, peekContact, activeRow, openSubMenu]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      setFacetMenuDismissed(false);
      setFacetPicker(false);
      setDiscardArmed(false);
      setLogNameHint("");
      // Typing again closes the actions menu, for the new results.
      if (subMenuContactId) {
        subMenuRowRef.current = "";
        closeSubMenu();
      }
    },
    [subMenuContactId, closeSubMenu],
  );

  const modeChipsId = useId();

  /**
   * A mode chip: its sign in front of the words, or none for Search. `>`
   * keeps them too, as the name to log for. The Filter chip shows "Filter
   * by", in Search.
   */
  const switchMode = (target: (typeof MODE_CHIPS)[number]["id"] | "filter") => {
    const words = search.replace(/^\s*[?>]\s*/, "");
    setSearch(
      target === "ai"
        ? `? ${words}`
        : target === "action"
          ? `> ${words}`
          : words,
    );
    setLogNameHint(target === "action" ? words.trim() : "");
    setFacetMenuDismissed(false);
    setDiscardArmed(false);
    setFacetPicker(target === "filter" ? !facetPicker : false);
    if (subMenuContactId) {
      subMenuRowRef.current = "";
      closeSubMenu();
    }
    inputRef.current?.focus();
  };

  /** "Filter by" picked a field: type it, and its values open. */
  const pickFacetField = (field: string) => {
    setSearch(`${search.trim() ? `${search.trim()} ` : ""}${field}:`);
    setFacetPicker(false);
    setFacetMenuDismissed(false);
  };

  // A new query puts the highlight back on the top row, as cmdk does.
  useEffect(() => {
    movedHighlightRef.current = false;
  }, [search, parsed.filters]);

  /**
   * Keeps one row highlighted, on the top row until the person moves it.
   * cmdk highlights nothing when its row leaves the list (it re-checks only
   * the last row to unmount), and follows a row the server ranks lower.
   *
   * Runs after every commit, because the rows come from a dozen sources. It
   * cannot loop: it saves the top row only when the highlight is elsewhere.
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
      // With its group's heading, and any note above the list.
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  });

  /**
   * Keeps `aria-activedescendant` on the highlighted row, and the row in
   * view. cmdk sets it before the rows show a new highlight, so it goes
   * stale. The list mounts a render late, in a portal, so this runs after
   * every render.
   */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const list = listRef.current;
    const root = list?.closest<HTMLElement>("[cmdk-root]");
    if (!input || !list || !root) return;
    const point = (attribute: string, id: string | undefined) => {
      if (!id) input.removeAttribute(attribute);
      else if (input.getAttribute(attribute) !== id) {
        input.setAttribute(attribute, id);
      }
    };
    const sync = () => {
      // The actions menu, the list picker and the facet values are lists of
      // their own: while one shows, the input points at it and its row.
      const popup = root.querySelector<HTMLElement>("[data-palette-popup]");
      if (popup) {
        point("aria-controls", popup.id);
        point(
          "aria-activedescendant",
          popup.querySelector('[role="option"][aria-selected="true"]')?.id,
        );
        return;
      }
      point("aria-controls", list.id);
      const row = list.querySelector('[cmdk-item][aria-selected="true"]');
      point("aria-activedescendant", row?.id);
      if (!row) return;
      // In view, as cmdk scrolls to a row the highlight may have left. The
      // top row shows its heading. Not for the pointer: the row would jump.
      if (pointerMovedRef.current) return;
      if (row === list.querySelector("[cmdk-item]")) {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      } else row.scrollIntoView({ block: "nearest" });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributeFilter: ["aria-selected"],
    });
    observer.observe(input, {
      attributeFilter: ["aria-activedescendant", "aria-controls"],
    });
    return () => observer.disconnect();
  });

  // AI loading: mutation is pending AND query is long enough
  const isAiLoading = mode === "ai" && semanticSearch.isPending;

  /**
   * What a screen reader hears about the list (WCAG 4.1.3): the count once
   * it settles, not the instant rows, and the AI wait.
   */
  const peopleCount = (n: number) =>
    n === 0 ? "No people found" : `${n} ${n === 1 ? "person" : "people"} found`;
  const listSettled =
    !parsed.freeText.trim() ||
    (!instantSearch.isInstant && !instantSearch.isFtsLoading);
  // The actions menu says whose actions they are. Under the open facet
  // values, a people count would describe a list nobody is picking from.
  const statusText = subMenuContactId
    ? `Actions for ${subMenuContactName}`
    : facetMenuOpen
      ? ""
      : mode === "ai"
        ? aiQuery.length < 3 || aiPending
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

  // Shift peeks: the input always has focus, and Shift types nothing.
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

  // What each mode's parts need: notes above the list, rows in it, and,
  // for `?`, the links below it.
  const aiModeProps = {
    question: aiQuery,
    pending: aiPending,
    loading: aiQuery.length >= 3 && isAiLoading && !aiPending,
    answered: semanticSearch.isSuccess,
    error: askFailed
      ? semanticSearch.error?.message || "Search failed. Try again"
      : null,
    results: aiResults,
    total: aiTotal,
    fallback: aiFallback,
    answeredQuery: aiAnsweredQuery,
    setup: aiSetup,
    onAsk: () => askAi(aiQuery, aiFilters),
    onPickStarter: (question: string) => {
      setSearch(`? ${question}`);
      askAi(question, aiFilters);
    },
    onOpenContact: handleSelectContact,
    onNavigate: handleNavigate,
  };
  const logModeProps = {
    input: search,
    contacts: allContacts,
    recentContacts,
    discardArmed,
    nameHint: logNameHint,
    onFill: (text: string) => {
      setSearch(text);
      setDiscardArmed(false);
    },
    onLog: handleLog,
    onCompose: setLogComposer,
  };
  const peopleModeProps = {
    results: instantSearch.results,
    loading: instantSearch.isFtsLoading,
    facetMenuOpen,
    hasFilters: parsed.filters.some((filter) => filter.field !== "near"),
    words: parsed.freeText,
    query: fullQuery,
    exactPage,
    canCreate,
    onOpen: handleSelectFtsContact,
    onActions: (person: {
      id: string;
      name: string;
      avatarUrl?: string | null;
    }) => openSubMenu(person),
    onCreate: handleCreateContact,
    // The pills go with the question.
    onAsk: () => {
      setSearch(`? ${parsed.freeText.trim()}`);
      askAi(parsed.freeText, parsed.filters);
    },
    onNavigate: handleNavigate,
  };

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
              onCloseAutoFocus={(e) => {
                const target = returnFocusRef.current;
                if (!target?.isConnected) return;
                e.preventDefault();
                target.focus({ preventScroll: true });
              }}
            >
              <Command
                label="Global command palette"
                value={activeRow}
                onValueChange={setActiveRow}
                onKeyDown={handleRootKeyDown}
                // Every row arrives filtered. cmdk's fuzzy filter scores only
                // a row's value, so it would hide a match on a company, a
                // nickname or a phone, and a `>` action's row.
                shouldFilter={false}
                // A click on the backdrop closes. The content fills the
                // viewport, so Radix's pointer-down-outside never fires.
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) {
                    handleClose();
                  }
                }}
                // A touch screen pins the panel near the top, clear of the
                // notch, so the on-screen keyboard leaves room for the list.
                // A short window, a phone on its side, does the same.
                className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 pointer-coarse:pt-[max(0.5rem,env(safe-area-inset-top))] pointer-coarse:px-[max(0.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] [@media(max-height:560px)]:pt-2 backdrop-blur-md bg-surface/40"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -20 }}
                  transition={{ duration: DURATION.fast, ease: EASE }}
                  // A press on the panel keeps the focus in the input, or the
                  // page behind takes the keys. A field still takes it.
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
                  // Never taller than the space above the keyboard
                  // (`--keyboard-inset`, from `useSoftKeyboard`). The list
                  // scrolls instead.
                  className="w-full max-w-2xl max-h-[calc(100dvh-var(--keyboard-inset,0px)-var(--viewport-offset,0px)-15vh-1rem)] pointer-coarse:max-h-[calc(100dvh-var(--keyboard-inset,0px)-var(--viewport-offset,0px)-max(0.5rem,env(safe-area-inset-top))-0.5rem)] [@media(max-height:560px)]:max-h-[calc(100dvh-var(--keyboard-inset,0px)-var(--viewport-offset,0px)-1rem)] glass-panel shadow-2xl rounded-3xl overflow-hidden flex flex-col font-body"
                >
                  {/* Facet pills */}
                  <FacetPills
                    filters={parsed.filters}
                    // The × goes with its pill: the focus goes back to the
                    // box, not to the dialog.
                    onRemove={(index) => {
                      removeFilter(index);
                      inputRef.current?.focus();
                    }}
                  />

                  {/*
              The mode icon, the input and the Escape hint. The input draws no
              ring: it has the focus for as long as the palette is open, so a
              ring would say nothing.
            */}
                  <div className="flex items-center px-4 py-2 pointer-fine:py-4 bg-surface-container-low gap-3">
                    <AnimatePresence mode="wait">
                      {mode === "ai" ? (
                        <motion.div key="ai-icon" {...ICON_SWAP}>
                          <Sparkles
                            className={`w-5 h-5 text-primary ${isAiLoading ? "animate-pulse" : ""}`}
                          />
                        </motion.div>
                      ) : mode === "action" ? (
                        <motion.div key="action-icon" {...ICON_SWAP}>
                          <Zap className="w-5 h-5 text-success" />
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
                      // A phone would capitalize "tag:" into "Tag:".
                      {...NO_AUTOCORRECT}
                      // Short, so a phone shows it whole. The mode chips
                      // under it name `?` and `>`.
                      placeholder={
                        hasFilters
                          ? "Add more filters or search…"
                          : "Search people and pages…"
                      }
                      aria-describedby={`${modeChipsId}-hint`}
                      className="flex-1 min-w-0 min-h-[44px] pointer-fine:min-h-0 bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant text-lg"
                    />
                    {/* What a screen reader hears after the box's name. */}
                    <span id={`${modeChipsId}-hint`} className="sr-only">
                      Type ? to ask AI, or &gt; to log a note, a call, a meeting
                      or an email
                    </span>
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
                    The modes, as buttons: a touch keyboard hides `?` and `>`.
                    Each puts its sign in front of the words already typed.
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
                    {/* The facets, for a person who does not know them, and
                        for a phone, which has no footer and hides `:` on a
                        second keyboard. */}
                    <button
                      type="button"
                      aria-pressed={facetPicker}
                      onClick={() => switchMode("filter")}
                      className={cn(
                        "hit-area state-layer ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors",
                        facetPicker
                          ? "bg-surface-container-high text-on-surface font-bold"
                          : "text-on-surface-variant",
                      )}
                    >
                      <ListFilter className="w-3 h-3" aria-hidden="true" />{" "}
                      Filter
                    </button>
                  </div>

                  {/* Facet autocomplete dropdown */}
                  {facetMenuOpen && parsed.activePrefix && (
                    <FacetAutocomplete
                      field={parsed.activePrefix.field}
                      partial={parsed.activePrefix.partial}
                      // `addFilter` also clears the partial, quoted ones too.
                      onSelect={addFilter}
                      // Escape hides the suggestions and leaves the text.
                      onDismiss={() => setFacetMenuDismissed(true)}
                    />
                  )}

                  {/*
                    The scroll area: notes above the list, the list, and the
                    links below it. The listbox holds rows only (axe's
                    aria-required-children).
                  */}
                  <div
                    ref={scrollRef}
                    // A Tab stop, so a keyboard can scroll it (axe's
                    // scrollable-region-focusable): its rows are reached by
                    // the input's active descendant, and are not focusable.
                    // The arrows and Enter still work from here.
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                    tabIndex={0}
                    // The pointer moved the highlight: the layout effect above
                    // keeps it where the pointer put it.
                    onPointerMove={() => {
                      movedHighlightRef.current = true;
                      pointerMovedRef.current = true;
                    }}
                    // 380 px on a desktop; on a touch screen, the room the
                    // panel has.
                    className="min-h-0 max-h-[380px] pointer-coarse:max-h-none overflow-y-auto overscroll-contain p-2 scrollbar-hide"
                  >
                    {subMenuContactId ? (
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
                        aiAllowed={aiAllowed}
                      />
                    ) : logComposer ? (
                      <InlineNoteComposer
                        contactId={logComposer.contact.id}
                        contactName={logComposer.contact.name}
                        type={logComposer.kind}
                        initialText={logComposer.text}
                        backLabel="contacts"
                        onBack={() => {
                          setLogComposer(null);
                          inputRef.current?.focus();
                        }}
                        onComplete={handleClose}
                      />
                    ) : facetPicker ? null : mode === "ai" ? (
                      <AiMode part="notes" {...aiModeProps} />
                    ) : mode === "action" ? (
                      <LogMode part="notes" {...logModeProps} />
                    ) : (
                      !isEmptyInput && (
                        <PeopleMode part="notes" {...peopleModeProps} />
                      )
                    )}

                    <Command.List ref={listRef} label="Results">
                      {subMenuContactId || logComposer ? null : facetPicker ? (
                        <FilterFields onPick={pickFacetField} />
                      ) : mode === "ai" ? (
                        <AiMode part="rows" {...aiModeProps} />
                      ) : mode === "action" ? (
                        <LogMode part="rows" {...logModeProps} />
                      ) : isEmptyInput ? (
                        <ZeroStateView
                          recentContacts={recentContacts}
                          historyEntries={searchHistory.recentDisplay}
                          insights={zeroState?.insights ?? []}
                          onSelectContact={handleSelectContact}
                          onSelectHistory={handleSelectHistory}
                          onSelectInsight={handleSelectInsight}
                          onNavigate={handleNavigate}
                          onStart={(what) =>
                            switchMode(what === "log" ? "action" : what)
                          }
                        />
                      ) : (
                        <PeopleMode part="rows" {...peopleModeProps} />
                      )}
                    </Command.List>

                    {!subMenuContactId &&
                      !logComposer &&
                      !facetPicker &&
                      mode === "ai" && <AiMode part="after" {...aiModeProps} />}
                  </div>

                  <div
                    role="status"
                    aria-label="Palette status"
                    className="sr-only"
                  >
                    {statusText}
                  </div>

                  {/* Shift-to-peek, in a portal on the body */}
                  <ResultPeek contact={peekContact} visible={peekVisible} />

                  {/* Footer: the keys that work on this row */}
                  <PaletteFooter
                    enter={
                      facetMenuOpen
                        ? "pick"
                        : subMenuContactId
                          ? "pick"
                          : logComposer
                            ? null
                            : enterActionFor(activeRow)
                    }
                    canAct={
                      !subMenuContactId &&
                      !logComposer &&
                      !facetMenuOpen &&
                      !!peekContact
                    }
                    canPeek={
                      !subMenuContactId &&
                      !logComposer &&
                      !facetMenuOpen &&
                      !!peekContact
                    }
                    escape={
                      facetMenuOpen
                        ? "hide"
                        : subMenuContactId || logComposer || facetPicker
                          ? "back"
                          : mode === "action" &&
                              parseLogInput(search).step === "text" &&
                              /:\s*\S/.test(search)
                            ? "discard"
                            : search !== "" || hasFilters
                              ? "clear"
                              : "close"
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
