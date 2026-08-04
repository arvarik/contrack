import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
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
import { useQueryTokenizer } from "../../hooks/useQueryTokenizer";
import {
  Search,
  UserPlus,
  Briefcase,
  Building,
  Zap,
  MessageSquare,
  Phone,
  Calendar,
  Mail,
  Sparkles,
  AlertTriangle,
  ArrowUpRight,
  ChevronsRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { KBD, KBD_SM, SECTION_BG } from "../../lib/styles";
import type { SemanticMatch, ZeroStateInsight } from "../../types";
import {
  getMode,
  EXAMPLE_QUERIES,
  GROUP_HEADING_DEFAULT,
  GROUP_HEADING_PRIMARY,
  GROUP_HEADING_EMERALD,
} from "./utils";
import { AIShimmerRow, AIResultCard } from "./AiComponents";
import { ZeroStateView } from "./ZeroStateView";
import { ScoreDot, LastContactLine, StaleChip } from "./ContactMetaBadges";
import { DataAgeHalo } from "./DataAgeHalo";
import { useGroundingCapacity, useEnrichContact } from "../../api/enrichment";
import { ResultPeek } from "./ResultPeek";
import { SynthesisBar } from "./SynthesisBar";
import type { PeekContact } from "./ResultPeek";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { FacetPills } from "./FacetPills";
import { FacetAutocomplete } from "./FacetAutocomplete";
import { ActionSubMenu } from "./ActionSubMenu";

// ─── Main component ───────────────────────────────────────────────────────────

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
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

  // ── Space-to-Peek state ──
  const [peekContact, setPeekContact] = useState<PeekContact | null>(null);
  const [peekVisible, setPeekVisible] = useState(false);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

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
        avatarUrl: null as string | null,
      }));
  }, [recentIds, allContacts]);

  // Track last fired query to prevent duplicate calls
  const prevAiQueryRef = useRef<string>("");

  // Track if a successful AI search was recorded for the current debounced query.
  // Without this, the recording effect re-fires on every keystroke while
  // `semanticSearch.isSuccess` stays true, leaving a trail of prefix entries
  // in "Recent Searches" (e.g. "vent", "ventu", "ventur", "venture").
  const lastRecordedAiRef = useRef<string>("");

  // Derive the raw NL query from the ? prefix
  const aiQuery = mode === "ai" ? search.replace(/^\?+\s*/, "").trim() : "";

  // Debounced counterpart — used as the canonical "settled" query for
  // recording into history, so we only persist queries the user paused on.
  const debouncedAiQuery =
    mode === "ai" ? debouncedSearch.replace(/^\?+\s*/, "").trim() : "";

  // Derive AI results directly from mutation data (reactive, no extra useState)
  const aiResults: SemanticMatch[] =
    mode === "ai" && semanticSearch.data ? semanticSearch.data.matches : [];
  const aiFallback: boolean = mode === "ai" && !!semanticSearch.data?.fallback;

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

  // Fire semantic search only when the *debounced* AI query settles.
  // Previously this read the live `aiQuery` but listed `debouncedSearch` as a
  // dependency, so the effect re-ran per keystroke and the debounce was a
  // no-op — every prefix the user typed hit the AI endpoint. Now the effect
  // genuinely waits for the user to pause before issuing a request, which
  // both reduces cost and dramatically improves answer quality (partial
  // queries embed/rerank poorly compared to fully-formed questions).
  useEffect(() => {
    if (mode !== "ai" || debouncedAiQuery.length < 3) return;
    if (debouncedAiQuery === prevAiQueryRef.current) return;
    prevAiQueryRef.current = debouncedAiQuery;
    semanticSearch.mutate(debouncedAiQuery);
  }, [mode, debouncedAiQuery]);

  // Reset mutation state when mode changes away from AI
  useEffect(() => {
    if (mode !== "ai") {
      semanticSearch.reset();
      prevAiQueryRef.current = "";
    }
  }, [mode]);

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
      searchHistory.addEntry(`? ${debouncedAiQuery}`, "ai");
    }
  }, [semanticSearch.isSuccess, aiResults.length, debouncedAiQuery, mode]);

  // Action mode (> prefix)
  const isAction = mode === "action";
  const actionMatch = useMemo(() => {
    if (!isAction) return null;
    const regex = /^>\s*(note|call|meeting|email)\s+([^:]+):\s*(.*)$/i;
    const match = search.match(regex);
    if (!match) return null;
    const [_, type, nameStr, content] = match;
    const typeLower = type.toLowerCase() as
      "note" | "call" | "meeting" | "email";
    const targetContact = allContacts.find((c) =>
      c.name?.toLowerCase().includes(nameStr.toLowerCase().trim()),
    );
    if (targetContact && content.trim()) {
      return {
        type: typeLower,
        contact: targetContact,
        content: content.trim(),
      };
    }
    return null;
  }, [search, allContacts, isAction]);

  // Global ⌘K / Ctrl+K listener.
  // Always opens with a fresh empty input — matches Spotlight/Linear/Raycast.
  // Power-users can press ↑ to recall prior queries from history.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch("");
    semanticSearch.reset();
    prevAiQueryRef.current = "";
    lastRecordedAiRef.current = "";
    searchHistory.resetNavigation();
    clearFilters();
    setSubMenuContactId(null);
    setSubMenuContactName("");
    setSubMenuContactAvatar(null);
  }, [clearFilters]);

  const handleCreateContact = async () => {
    if (!search.trim()) return;
    try {
      const newContact = await createContact.mutateAsync({
        name: search.trim(),
        cadenceDays: 90,
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

  const handleActionExecute = async () => {
    if (!actionMatch) return;
    try {
      const titleMap: Record<string, string> = {
        note: "Quick Note",
        call: "Phone Call logged",
        meeting: "Meeting summary",
        email: "Email sent",
      };
      await addInteraction.mutateAsync({
        contactId: actionMatch.contact.id,
        data: {
          type: actionMatch.type,
          title: titleMap[actionMatch.type],
          content: actionMatch.content,
          date: new Date().toISOString(),
        },
      });
      // Record action to history
      searchHistory.addEntry(search, "action");
      handleClose();
      toast.success(
        `Logged ${actionMatch.type} for ${actionMatch.contact.name}`,
      );
    } catch (e: unknown) {
      toast.error(
        `Failed to log interaction: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case "note":
        return <MessageSquare className="w-4 h-4" />;
      case "email":
        return <Mail className="w-4 h-4" />;
      case "call":
        return <Phone className="w-4 h-4" />;
      case "meeting":
        return <Calendar className="w-4 h-4" />;
      default:
        return <Zap className="w-4 h-4" />;
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

  const handleSelectHistory = useCallback((query: string) => {
    setSearch(query);
    searchHistory.resetNavigation();
  }, []);

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
      if (insight.type === "action_items") {
        navigate("/pulse");
      } else if (insight.type === "stale_data") {
        navigate("/settings");
      } else if (insight.type === "dedupe") {
        navigate("/pulse");
      } else if (insight.contact) {
        recordVisit(insight.contact.id);
        navigate(`/contact/${insight.contact.id}`);
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

  // ── Terminal-style ↑/↓ history navigation ──

  const handleSearchInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Backspace on empty input deletes the last facet pill
      if (e.key === "Backspace" && search === "" && hasFilters) {
        e.preventDefault();
        removeLastFilter();
        return;
      }

      // Only handle ↑/↓ when input is empty (zero-state)
      if (search.trim() === "" && !hasFilters) {
        if (e.key === "ArrowUp") {
          const historyQuery = searchHistory.navigateHistory("up", search);
          if (historyQuery !== null) {
            e.preventDefault();
            setSearch(historyQuery);
          }
          return;
        }
        if (e.key === "ArrowDown" && searchHistory.historyIndex >= 0) {
          const historyQuery = searchHistory.navigateHistory("down", search);
          if (historyQuery !== null) {
            e.preventDefault();
            setSearch(historyQuery);
          }
          return;
        }
      }
    },
    [search, searchHistory, hasFilters, removeLastFilter],
  );

  // Is the input empty? (determines zero-state vs search results)
  const isEmptyInput = search.trim() === "" && !hasFilters;

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

      // Find the currently focused result
      const selected = listRef.current?.querySelector(
        '[aria-selected="true"]',
      ) as HTMLElement | null;
      if (!selected) return;

      // Extract contact ID from data-value
      const value = selected.getAttribute("data-value") || "";
      for (const contact of instantSearch.results) {
        if (value.includes(contact.id)) {
          e.preventDefault();
          setSubMenuContactId(contact.id);
          setSubMenuContactName(contact.name);
          setSubMenuContactAvatar(contact.avatarUrl ?? null);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleArrowRight);
    return () => window.removeEventListener("keydown", handleArrowRight);
  }, [open, subMenuContactId, mode, isEmptyInput, instantSearch.results]);

  // Reset history navigation when user types
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (searchHistory.historyIndex >= 0) {
        searchHistory.resetNavigation();
      }
      // Clear sub-menu if user starts typing again
      if (subMenuContactId) {
        setSubMenuContactId(null);
      }
    },
    [searchHistory.historyIndex, subMenuContactId],
  );

  // AI loading: mutation is pending AND query is long enough
  const isAiLoading = mode === "ai" && semanticSearch.isPending;

  // ── Space-to-Peek: track focused result via MutationObserver ──
  useEffect(() => {
    if (!open) {
      setPeekContact(null);
      setPeekVisible(false);
      return;
    }

    const checkFocused = () => {
      const el = listRef.current;
      if (!el) return;
      const selected = el.querySelector(
        '[aria-selected="true"]',
      ) as HTMLElement | null;
      if (!selected) {
        setPeekContact(null);
        return;
      }
      // Extract contact ID from the cmdk value attribute
      const value = selected.getAttribute("data-value") || "";
      // FTS results use "id + name" as value, AI uses "ai_id_name"
      // Try to find a matching contact from our result map
      for (const [id, contact] of resultMap) {
        if (value.includes(id)) {
          setPeekContact(contact);
          return;
        }
      }
      setPeekContact(null);
    };

    // Observe aria-selected changes
    const el = listRef.current;
    if (!el) return;
    const observer = new MutationObserver(checkFocused);
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["aria-selected"],
      subtree: true,
    });
    checkFocused(); // Initial check

    return () => observer.disconnect();
  }, [open, resultMap]);

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
        <Command.Dialog
          open={open}
          onOpenChange={(v) => {
            if (!v) {
              // Escape stack: sub-menu open → close sub-menu, not palette
              if (subMenuContactId) {
                setSubMenuContactId(null);
                setSubMenuContactName("");
                setSubMenuContactAvatar(null);
                return;
              }
              handleClose();
            } else {
              setOpen(true);
            }
          }}
          label="Global Command Palette"
          shouldFilter={
            mode !== "ai" && !isEmptyInput && !subMenuContactId && !hasFilters
          }
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
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-md bg-surface/40 transition-all duration-200"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-2xl glass-panel shadow-2xl rounded-2xl overflow-hidden flex flex-col font-body"
          >
            {/* ── Facet pills (Feature 5) ── */}
            <FacetPills filters={parsed.filters} onRemove={removeFilter} />

            {/* ── Search input row ── */}
            <div className="flex items-center px-4 py-4 bg-surface-container-low gap-3">
              <AnimatePresence mode="wait">
                {mode === "ai" ? (
                  <motion.div
                    key="ai-icon"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Sparkles
                      className={`w-5 h-5 text-primary ${isAiLoading ? "animate-pulse" : ""}`}
                    />
                  </motion.div>
                ) : mode === "action" ? (
                  <motion.div
                    key="action-icon"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Zap className="w-5 h-5 text-emerald-500 animate-pulse" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="search-icon"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Search className="w-5 h-5 text-on-surface-variant" />
                  </motion.div>
                )}
              </AnimatePresence>

              <Command.Input
                value={search}
                onValueChange={handleSearchChange}
                onKeyDown={handleSearchInputKeyDown}
                autoFocus
                placeholder={
                  hasFilters
                    ? "Add more filters or search..."
                    : "Search contacts, ? to ask AI, > for actions..."
                }
                className="flex-1 bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-on-surface-variant outline-none text-lg"
              />
              <div className="flex items-center gap-1.5 opacity-50">
                <kbd className={KBD}>ESC</kbd>
              </div>
            </div>

            {/* ── Mode indicator ribbon ── */}
            <div className="flex items-center gap-3 px-4 py-1.5 bg-surface-container-low/50 text-[11px] border-t border-surface-container">
              <span
                className={`flex items-center gap-1 ${mode === "normal" ? "text-on-surface font-bold" : "text-on-surface-variant/50"}`}
              >
                <Search className="w-3 h-3" /> Search
              </span>
              <span className="text-on-surface-variant/20">•</span>
              <span
                className={`flex items-center gap-1 ${mode === "ai" ? "text-primary font-bold" : "text-on-surface-variant/50"}`}
              >
                <Sparkles className="w-3 h-3" /> ? AI Query
              </span>
              <span className="text-on-surface-variant/20">•</span>
              <span
                className={`flex items-center gap-1 ${mode === "action" ? "text-emerald-500 font-bold" : "text-on-surface-variant/50"}`}
              >
                <Zap className="w-3 h-3" /> &gt; Actions
              </span>
            </div>

            {/* ── Result list ── */}
            {/* ── Facet autocomplete dropdown (Feature 5) ── */}
            {parsed.activePrefix && (
              <FacetAutocomplete
                field={parsed.activePrefix.field}
                partial={parsed.activePrefix.partial}
                onSelect={(filter) => {
                  addFilter(filter);
                  // Clear the partial from input
                  setSearch(search.replace(/\b\w+:\S*$/, "").trim());
                }}
                onDismiss={() => {
                  // Remove the active prefix from input
                  setSearch(search.replace(/\b\w+:$/, "").trim());
                }}
              />
            )}

            <Command.List
              ref={listRef}
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
                  onBack={() => {
                    setSubMenuContactId(null);
                    setSubMenuContactName("");
                    setSubMenuContactAvatar(null);
                  }}
                  onClose={handleClose}
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
                  {aiQuery.length === 0 && (
                    <Command.Empty className="py-8 text-center text-sm text-on-surface-variant">
                      <Sparkles className="w-8 h-8 text-primary/30 mx-auto mb-3" />
                      <p className="font-bold text-on-surface mb-1">
                        AI Query Mode
                      </p>
                      <p className="text-xs mb-4">
                        Ask anything about your network in plain English.
                      </p>
                      <div className="space-y-1.5 text-left max-w-xs mx-auto">
                        {EXAMPLE_QUERIES.map((q) => (
                          <button
                            key={q}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSearch(`? ${q}`);
                            }}
                            className="w-full text-left text-xs px-3 py-2 rounded-lg bg-primary/5 hover:bg-primary/10 text-primary/70 hover:text-primary transition-colors"
                          >
                            ? {q}
                          </button>
                        ))}
                      </div>
                    </Command.Empty>
                  )}

                  {/* Short query — waiting for more input */}
                  {aiQuery.length > 0 && aiQuery.length < 3 && (
                    <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                      <Sparkles className="w-6 h-6 text-primary/30 mx-auto mb-2" />
                      <p className="text-xs">Keep typing to search…</p>
                    </Command.Empty>
                  )}

                  {/* Loading shimmer */}
                  {aiQuery.length >= 3 && isAiLoading && (
                    <div className="px-1 py-2 space-y-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary/60 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 animate-pulse" /> Asking
                        AI…
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
                        heading={
                          aiFallback
                            ? "Keyword Results (AI Fallback)"
                            : "AI Query Results"
                        }
                        className={GROUP_HEADING_PRIMARY}
                      >
                        {aiFallback && (
                          <div className="flex items-center gap-1.5 px-3 pb-1 text-xs text-amber-600">
                            <AlertTriangle className="w-3 h-3" />
                            <span>
                              AI unavailable — showing keyword matches
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
                            onRefresh={handleRefreshContact}
                          />
                        ))}
                      </Command.Group>
                    )}

                  {/* Synthesis executive brief (Feature 6) */}
                  {aiQuery.length >= 3 &&
                    !isAiLoading &&
                    aiResults.length > 0 && (
                      <SynthesisBar
                        query={aiQuery}
                        contacts={aiResults}
                        resultCount={aiResults.length}
                        compact
                      />
                    )}

                  {/* "Open in full-page search" bridge (Feature 11C) */}
                  {aiQuery.length >= 3 &&
                    !isAiLoading &&
                    aiResults.length > 0 && (
                      <div className="px-3 py-2 flex justify-end">
                        <button
                          onClick={() => {
                            navigate(
                              `/search?q=${encodeURIComponent(aiQuery)}`,
                            );
                            handleClose();
                          }}
                          className="text-xs text-primary/60 hover:text-primary flex items-center gap-1 transition-colors group"
                        >
                          Open in full-page search
                          <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                        </button>
                      </div>
                    )}

                  {/* No AI matches */}
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
                          Try rephrasing your query, or use the regular search.
                        </p>
                      </Command.Empty>
                    )}
                </>
              )}

              {/* ═══════════════ ACTION MODE ═══════════════ */}
              {!subMenuContactId && mode === "action" && !actionMatch && (
                <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                  <Zap className="w-8 h-8 text-on-surface-variant/30 mx-auto mb-3" />
                  <p className="font-bold text-on-surface">
                    Action Mode Active
                  </p>
                  <p className="mt-1">
                    Syntax:{" "}
                    <code className="text-primary bg-primary/10 px-1 rounded">
                      &gt; [type] [name]: [content]
                    </code>
                  </p>
                  <p className="mt-2 text-xs">
                    Types: note, call, meeting, email
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Example:{" "}
                    <code>
                      &gt; note Julian: Left a voicemail regarding Q3 targets
                    </code>
                  </p>
                </Command.Empty>
              )}

              {!subMenuContactId && mode === "action" && actionMatch && (
                <Command.Group
                  heading="Action Engine"
                  className={GROUP_HEADING_EMERALD}
                >
                  <Command.Item
                    value={`action_${actionMatch.type}_${actionMatch.contact.id}`}
                    onSelect={handleActionExecute}
                    className="flex items-center gap-4 px-3 py-4 rounded-xl cursor-default select-none bg-emerald-500/10 aria-selected:bg-emerald-500/15 transition-colors text-on-surface"
                  >
                    <div className="w-10 h-10 flex items-center justify-center bg-emerald-500/20 text-emerald-500 rounded-full shrink-0 shadow-lg shadow-emerald-500/10">
                      {getLogIcon(actionMatch.type)}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="font-bold text-sm block truncate">
                        Log {actionMatch.type} for{" "}
                        <span className="text-emerald-400">
                          {actionMatch.contact.name}
                        </span>
                      </span>
                      <span className="text-sm text-on-surface-variant truncate mt-0.5">
                        "{actionMatch.content}"
                      </span>
                    </div>
                    <div className="shrink-0 opacity-50 px-2 flex items-center justify-center space-x-1">
                      <span className="text-xs">Press</span>
                      <kbd className={KBD}>Enter</kbd>
                    </div>
                  </Command.Item>
                </Command.Group>
              )}

              {/* ═══════════════ NORMAL MODE (with search text or facets) ═══════════════ */}
              {!subMenuContactId && mode === "normal" && !isEmptyInput && (
                <>
                  <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                    {instantSearch.isFtsLoading
                      ? "Searching..."
                      : "No results found."}
                  </Command.Empty>

                  {instantSearch.results.length > 0 && (
                    <Command.Group
                      heading={
                        <span className="flex items-center gap-1.5">
                          Contacts
                          {instantSearch.isInstant && (
                            <span className="text-amber-500 text-[9px] font-bold uppercase tracking-widest animate-pulse">
                              ⚡ instant
                            </span>
                          )}
                          {hasFilters && (
                            <span className="text-primary/50 text-[9px] font-bold uppercase tracking-widest">
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
                          onSelect={() => handleSelectFtsContact(contact.id)}
                          className="flex items-start gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-primary/10 aria-selected:text-primary transition-colors text-on-surface group/result"
                        >
                          <DataAgeHalo updatedAt={contact.updatedAt}>
                            <img
                              src={
                                contact.avatarUrl ||
                                fallbackAvatarUrl(contact.name)
                              }
                              alt=""
                              className="w-8 h-8 rounded-full bg-surface-container-highest object-cover"
                            />
                          </DataAgeHalo>
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm truncate">
                                {contact.name}
                              </span>
                              <ScoreDot
                                score={contact.relationshipScore ?? null}
                              />
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
                              onRefresh={handleRefreshContact}
                            />
                          </div>
                          {/* → action button: always visible on mobile (touch), hover-reveal on desktop */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubMenuContactId(contact.id);
                              setSubMenuContactName(contact.name);
                              setSubMenuContactAvatar(contact.avatarUrl);
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                            className="shrink-0 flex items-center gap-1 sm:opacity-0 sm:group-hover/result:opacity-50 sm:aria-selected:opacity-50 opacity-40 active:opacity-80 transition-opacity text-[10px] text-on-surface-variant self-center p-1.5 -mr-1 rounded-lg sm:p-0 sm:mr-0 active:bg-surface-container-high sm:active:bg-transparent"
                            aria-label={`Actions for ${contact.name}`}
                          >
                            <ChevronsRight className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}

                  {parsed.freeText.trim().length > 0 &&
                    instantSearch.results.length === 0 &&
                    !instantSearch.isFtsLoading && (
                      <Command.Group
                        heading="Actions"
                        className={`mt-2 text-on-surface-variant ${GROUP_HEADING_DEFAULT}`}
                      >
                        <Command.Item
                          value={`create_${search}`}
                          onSelect={handleCreateContact}
                          className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-surface-container-high transition-colors text-on-surface"
                        >
                          <div className="w-8 h-8 flex items-center justify-center bg-surface-container-highest rounded-full">
                            <UserPlus className="w-4 h-4 text-primary" />
                          </div>
                          <span className="text-sm">
                            Create new contact{" "}
                            <span className="font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] inline-block align-bottom">
                              "{parsed.freeText}"
                            </span>
                          </span>
                        </Command.Item>
                      </Command.Group>
                    )}
                </>
              )}
            </Command.List>

            {/* ── Space-to-Peek portal ── */}
            <ResultPeek contact={peekContact} visible={peekVisible} />

            {/* ── Footer ── */}
            <div
              className={`px-4 py-2.5 ${SECTION_BG} text-[11px] text-on-surface-variant hidden sm:flex items-center justify-between`}
            >
              <span className="flex items-center gap-2">
                Use <kbd className={KBD_SM}>↑</kbd>{" "}
                <kbd className={KBD_SM}>↓</kbd> to navigate
                {isEmptyInput && searchHistory.entries.length > 0 && (
                  <span className="text-on-surface-variant/40 ml-1">
                    • ↑ for history
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1">
                {!isEmptyInput && !subMenuContactId && (
                  <span className="text-on-surface-variant/40 mr-2">
                    <kbd className={KBD_SM}>→</kbd> actions
                  </span>
                )}
                {!isEmptyInput && peekContact && !subMenuContactId && (
                  <span className="text-on-surface-variant/40 mr-2">
                    Hold <kbd className={KBD_SM}>Shift</kbd> to peek
                  </span>
                )}
                <kbd className={KBD_SM}>Enter</kbd> to select
              </span>
            </div>
          </motion.div>
        </Command.Dialog>
      )}
    </AnimatePresence>
  );
};
