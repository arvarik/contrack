import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isTypingTarget } from "../lib/keyboard";
import {
  Sparkles,
  Search,
  X,
  AlertTriangle,
  HistoryIcon,
  RefreshCw,
  RotateCw,
  SearchX,
} from "lucide-react";
import { useSemanticSearch } from "../api";
import { useContacts } from "../api/contacts";
import { useRecordSearch } from "../api/searchHistory";
import { usePreferences } from "../contexts/PreferencesContext";
import { useMediaQuery, WIDE_QUERY } from "../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../hooks/useSingleKeyShortcuts";
import {
  ASK_COLUMN,
  BTN_QUIET,
  CARD,
  ICON_BTN,
  PAGE_TOP,
  SECTION_HEADING,
  SUGGESTION_CHIP,
} from "../lib/styles";
import { cn } from "../lib/utils";
import { tileDelay } from "../lib/motion";
import { FloatingContactCard } from "../components/FloatingContactCard";
import { SynthesisBar } from "../components/command-palette/SynthesisBar";
import { CorvidThinking } from "../components/brand/CorvidThinking";
import { PageHeader } from "../components/layout/PageHeader";
import { SidePanel } from "../components/layout/SidePanel";
import { usePageTitle } from "../hooks/usePageTitle";
import { NAMES } from "../lib/names";
import { ResultCard, ShimmerCard } from "./search/SearchResultCards";
import { SearchCoverageBar, HistoryPane } from "./search";
import { InteractionSearchPanel } from "./search/InteractionSearchPanel";
import { suggestedQuestions } from "./search/suggestions";
import { Segmented } from "../components/ui/Segmented";
import { IconButton } from "../components/ui/IconButton";
import { Modal } from "../components/ui/Modal";
import { LiveStatus } from "../components/ui/LiveStatus";
import { EmptyState } from "../components/ui/EmptyState";
import { peopleSearchStatus } from "../lib/searchAnnouncements";
import { useSession } from "../contexts/SessionContext";
import type { HistoryEntry } from "../../shared/searchHistory";
import { useAiAllowed } from "../hooks/useAiAllowed";

// =============================================================================
// SearchView — Dedicated full-page "Ask Contrack" semantic search
// =============================================================================
// Two modes share the page. People is the AI search over contacts. Notes is
// the local search over what was written about them, with the date and the
// passage that matched. The mode lives in the URL as `?mode=notes`, so the
// command palette can link straight to a note search and Back returns to it.

type SearchMode = "people" | "notes";

const MODES: readonly { value: SearchMode; label: string }[] = [
  { value: "people", label: "People" },
  { value: "notes", label: "Notes" },
];

// ─── Main SearchView Component ────────────────────────────────────────────────

export const SearchView = () => {
  const mountStart = useRef(performance.now());
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(
        `[Perf] SearchView mounted in ${(performance.now() - mountStart.current).toFixed(2)}ms`,
      );
    }
  }, []);

  const {
    lastAISearchQuery,
    setLastAISearchQuery,
    lastAISearchData,
    setLastAISearchData,
    lastAISearchPhase,
    setLastAISearchPhase,
  } = useSession();

  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The editable input. `lastAISearchQuery` is what the input is restored
   * to on the way back to this page, and it is written when a question is
   * submitted, so the input comes back showing the question the results
   * answer. It is not the question itself: that travels with the results,
   * as `semanticSearch.data.query`, and the synthesis brief reads it there.
   */
  const [query, setQuery] = useState(lastAISearchQuery);

  const semanticSearch = useSemanticSearch({
    data: lastAISearchData,
    setData: setLastAISearchData,
    phase: lastAISearchPhase,
    setPhase: setLastAISearchPhase,
  });
  const { submittedQuery, isPending, mutate, reset } = semanticSearch;

  const [floatingContactId, setFloatingContactId] = useState<string | null>(
    null,
  );

  // Read ?q= URL param on mount (from Cmd+K "Open in full-page search" bridge)
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQueryHandled = useRef(false);

  const navigate = useNavigate();
  const { preferences, setPreference } = usePreferences();
  /** The side panel, from `lg`: open or closed is an account preference. */
  const askHistoryOpen = preferences.askHistoryOpen;
  const isWide = useMediaQuery(WIDE_QUERY);
  /** The sheet, below `lg`, where the header's History button opens it. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const singleKeys = useSingleKeyShortcuts();
  const aiAllowed = useAiAllowed();
  const recordSearch = useRecordSearch();
  const lastRecordedPeopleQueryRef = useRef<string | null>(null);

  const mode: SearchMode =
    searchParams.get("mode") === "notes" ? "notes" : "people";
  const setMode = useCallback(
    (next: SearchMode) => {
      setSearchParams(next === "notes" ? { mode: "notes" } : {}, {
        replace: true,
      });
    },
    [setSearchParams],
  );

  usePageTitle(mode === "notes" ? "Search notes" : NAMES.ask.title);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Ask a question.
   *
   * The only guard is against the same question while it is still being
   * answered: Enter and the Search button both land here, and a second copy
   * of a request in flight is a duplicate, not a retry. The guard reads the
   * question the hook is answering, so it clears when the search does. This
   * used to be a ref of the view's own, which Clear never reset, so a
   * question once asked could not be asked again until a different one had
   * been asked in between.
   *
   * The same question with its results already on screen runs again. That
   * is what pressing Search means, and it is what the Refresh button beside
   * the results does with one click fewer.
   */
  const handleSearch = useCallback(
    (searchQuery?: string) => {
      const q = (searchQuery ?? query).trim();
      if (q.length < 3) return;
      if (isPending && q === submittedQuery) return;
      lastRecordedPeopleQueryRef.current = null;
      setLastAISearchQuery(q);
      mutate(q);
    },
    [query, isPending, submittedQuery, mutate, setLastAISearchQuery],
  );

  /** Ask the question the current results or the failed search belong to. */
  const handleRerun = useCallback(() => {
    if (submittedQuery) handleSearch(submittedQuery);
  }, [submittedQuery, handleSearch]);

  const setHistoryOpen = useCallback(
    (open: boolean) => setPreference("askHistoryOpen", open),
    [setPreference],
  );

  /** Close the sheet. The sheet hands focus back to the History button. */
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  /** The key that toggles the history, while single-key shortcuts are on. */
  const historyShortcut = singleKeys ? "H" : undefined;

  const handleSelectHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      if (entry.mode === "notes") {
        navigate(`/search?mode=notes&q=${encodeURIComponent(entry.query)}`);
      } else {
        if (mode !== "people") {
          setMode("people");
        }
        setQuery(entry.query);
        handleSearch(entry.query);
      }
    },
    [mode, setMode, handleSearch, navigate],
  );

  // Record completed People search once
  useEffect(() => {
    if (mode !== "people") return;
    const isDone = semanticSearch.phase === "done" || semanticSearch.isSuccess;
    if (!isDone || semanticSearch.isError || !semanticSearch.data) return;

    const dataQuery = semanticSearch.data.query?.trim();
    if (!dataQuery || dataQuery.length < 3) return;

    if (lastRecordedPeopleQueryRef.current === dataQuery) return;
    lastRecordedPeopleQueryRef.current = dataQuery;

    recordSearch.mutate({
      query: dataQuery,
      mode: "people",
      resultCount: semanticSearch.data.matches?.length ?? 0,
      resultIds: (semanticSearch.data.matches ?? [])
        .slice(0, 30)
        .map((m) => m.id),
      fallback: semanticSearch.data.fallback ?? false,
    });
  }, [
    mode,
    semanticSearch.phase,
    semanticSearch.isSuccess,
    semanticSearch.isError,
    semanticSearch.data,
    recordSearch,
  ]);

  // Auto-fire search if ?q= param is present on mount. Through handleSearch,
  // so the bridge records the question the way a typed one is recorded and
  // the input is restored to it on the way back. In Notes mode the panel owns
  // the URL, and `q` there is its question, not this one.
  useEffect(() => {
    if (initialQueryHandled.current || mode === "notes") return;
    const urlQuery = searchParams.get("q")?.trim();
    if (urlQuery && urlQuery.length >= 3) {
      initialQueryHandled.current = true;
      setQuery(urlQuery);
      // Clear the param to avoid re-firing on back navigation
      setSearchParams({}, { replace: true });
      handleSearch(urlQuery);
    }
  }, [searchParams, setSearchParams, handleSearch, mode]);

  const handleClear = useCallback(() => {
    setQuery("");
    reset();
    setLastAISearchQuery("");
    inputRef.current?.focus();
  }, [reset, setLastAISearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      }
    },
    [handleSearch, handleClear],
  );

  // Global keydown for focusing search and toggling history
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (!singleKeys) return;
      // A key pressed in a dialog belongs to the dialog: H in the history's
      // Clear confirmation would close the pane under it.
      if (e.target instanceof Element && e.target.closest('[role="dialog"]'))
        return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (
        e.key.toLowerCase() === "h" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        // The sheet is a dialog, and a key pressed in it is its own, so
        // below `lg` H only opens it.
        if (!isWide) {
          setSheetOpen(true);
          return;
        }
        // With focus inside the panel, H is its Hide button: `SidePanel`
        // moves the keyboard to the rail icon that brings it back.
        setHistoryOpen(!askHistoryOpen);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [singleKeys, isWide, askHistoryOpen, setHistoryOpen]);

  // Built from the network, which the Network list has most often loaded
  // already (the two share one cache). The list waits for the network to
  // settle, so its chips never move under a pointer when it arrives. A
  // failed load shows the fixed examples.
  const { data: contacts, isPending: contactsPending } = useContacts();
  const suggestions = useMemo(
    () => suggestedQuestions(Array.isArray(contacts) ? contacts : []),
    [contacts],
  );

  const handleExampleClick = useCallback(
    (exampleQuery: string) => {
      setQuery(exampleQuery);
      handleSearch(exampleQuery);
    },
    [handleSearch],
  );
  /** Names the list of suggested questions after its heading. */
  const suggestionsId = useId();

  const results = semanticSearch.data?.matches ?? [];
  const isFallback = semanticSearch.data?.fallback ?? false;
  /** The question the results on screen answer. Never the input. */
  const answeredQuery = semanticSearch.data?.query ?? "";
  const isLoading = isPending && results.length === 0;
  const isEnriching = semanticSearch.phase === "enriching";
  const hasSearched =
    semanticSearch.isSuccess || semanticSearch.isError || results.length > 0;

  /**
   * The one sentence a screen reader hears about this search. The thinking
   * bird, the "Searching…" line and the count pill below are what a
   * sighted person sees; none of them is announced. See
   * lib/searchAnnouncements.
   */
  const status = peopleSearchStatus({
    isLoading,
    isEnriching,
    isError: semanticSearch.isError,
    hasSearched,
    count: results.length,
    query: answeredQuery || submittedQuery || "",
    fallback: isFallback,
  });

  /** What the history marks as the question on screen. */
  const historyQuery =
    mode === "notes" ? (searchParams.get("q") ?? "") : answeredQuery || query;

  return (
    <div className="h-full flex overflow-hidden bg-surface">
      {/*
        The page scrolls as one column: the header, then the search and its
        results, in one box with one pair of gutters, so the title's left
        edge is the search box's left edge. The header scrolls away with the
        page, as it does on Pulse. The scroll padding keeps a card that Tab
        brings into view clear of the edge, so its focus ring is never cut.
        The bar's lane is kept while nothing scrolls, so the column does not
        move when the results make the page scroll.
      */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto scroll-py-2 [scrollbar-gutter:stable]">
        <div
          className={cn(
            ASK_COLUMN,
            "px-4 sm:px-6 space-y-6 sm:space-y-8 pb-28 md:pb-8",
            PAGE_TOP,
          )}
        >
          {/* The title and the mode switch, nothing else: the search box
              under it says what the page is for. */}
          <PageHeader
            title={NAMES.ask.label}
            // The switch is the same in both modes, so it stays where the
            // person clicked it. On a phone the controls fill the row
            // under the title, the switch growing beside History.
            actionsClassName="max-sm:w-full"
            actions={
              <>
                <Segmented
                  options={MODES}
                  value={mode}
                  onChange={setMode}
                  label="What to search"
                  className="max-sm:w-auto max-sm:flex-1"
                />
                {/* From `lg` the rail's icon opens the history. Below it
                    there is no rail, and this opens the sheet. */}
                {!isWide && (
                  <IconButton
                    ref={historyButtonRef}
                    aria-label="History"
                    title={
                      historyShortcut
                        ? `History (${historyShortcut})`
                        : "History"
                    }
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                    onClick={() => setSheetOpen(true)}
                  >
                    <HistoryIcon className="w-5 h-5" aria-hidden="true" />
                  </IconButton>
                )}
              </>
            }
          />
          {mode === "notes" ? (
            <InteractionSearchPanel />
          ) : (
            <>
              <LiveStatus message={status} label="Search status" />

              {/*
                The search box, and under it the index's one line while
                People search cannot read the whole network yet.
              */}
              <div className="space-y-3">
                {/*
                  The search box is one field: the glyph, the input, Clear
                  and Search in one card. The card draws the focus ring
                  while the input has focus (`focus-frame`). The button
                  drops below the field on phones, with the card's side
                  padding under it. It is the one raised surface on the
                  page, and 80 px tall from `sm`, the same as the Notes
                  box, so switching modes moves nothing.
                */}
                <div
                  className={cn(
                    CARD,
                    "focus-frame flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 sm:px-6 pt-2 pb-4 sm:py-5",
                  )}
                >
                  {isLoading ? (
                    // Decorative: the "Searching…" line under the box says
                    // the same thing in words, and the status region reads it.
                    <CorvidThinking
                      decorative
                      size={20}
                      className="text-primary shrink-0"
                    />
                  ) : (
                    <Sparkles className="w-5 h-5 text-primary shrink-0" />
                  )}
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    // Short enough to survive a 390px viewport without the
                    // placeholder being clipped mid-word.
                    placeholder="Ask about your network…"
                    aria-label="Ask anything about your network"
                    // 44px tall on a phone, the touch floor, and the Search
                    // button's 40 px from `sm`.
                    className="flex-1 min-w-0 h-11 sm:h-10 bg-transparent border-none text-on-surface placeholder:text-on-surface-variant text-base sm:text-lg"
                  />
                  {/*
                    Reserved slot, not an AnimatePresence exit. Mounting and
                    unmounting the clear button changed the row's width
                    mid-typing and nudged the caret; now the space is always
                    there and only the button's opacity changes.
                  */}
                  <button
                    onClick={handleClear}
                    tabIndex={query.length > 0 ? 0 : -1}
                    aria-hidden={query.length === 0}
                    className={cn(
                      ICON_BTN,
                      "p-1.5 shrink-0 transition-opacity",
                      query.length === 0 && "opacity-0 pointer-events-none",
                    )}
                    aria-label="Clear search"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleSearch()}
                    disabled={query.trim().length < 3 || isLoading}
                    className="btn-primary w-full sm:w-auto shrink-0"
                  >
                    <Search className="w-4 h-4" />
                    Search
                  </button>
                </div>
                <SearchCoverageBar variant="row" returnFocusRef={inputRef} />
              </div>

              {/* Suggested questions, before the first search. A press
                  fills the box and asks. */}
              {!hasSearched && !isLoading && !contactsPending && (
                <div className="space-y-3">
                  <h2 id={suggestionsId} className={SECTION_HEADING}>
                    Try asking
                  </h2>
                  <ul
                    aria-labelledby={suggestionsId}
                    className="flex flex-wrap gap-2"
                  >
                    {suggestions.map((q, i) => (
                      <li
                        key={q}
                        className="tile-enter"
                        style={{ animationDelay: tileDelay(i) }}
                      >
                        <button
                          type="button"
                          onClick={() => handleExampleClick(q)}
                          className={SUGGESTION_CHIP}
                        >
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
                Shimmer and results share one keyed slot and crossfade with
                CSS.

                This used to be `<AnimatePresence mode="popLayout">`, which
                yanks the exiting shimmer into `position: absolute` for the
                length of its exit — and for those frames the shimmer sits on
                top of the incoming cards at a stale width. A keyed
                `.fade-enter` swaps in one commit: the outgoing tree is gone
                before the new one paints, so there is nothing to overlap.
              */}
              {isLoading ? (
                <div key="shimmer" className="fade-enter space-y-3">
                  <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-[0.08em] mb-4">
                    {/* Decorative: the word beside it says the same thing. */}
                    <CorvidThinking decorative size={16} />
                    Searching…
                  </div>
                  <ShimmerCard delay={0} />
                  <ShimmerCard delay={0.08} />
                  <ShimmerCard delay={0.16} />
                </div>
              ) : results.length > 0 ? (
                <div key="results" className="fade-enter space-y-3">
                  {/* Results header — wraps rather than crushes on narrow screens */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      {/* A label in the muted ink, like "Try asking": blue
                          would read as a link. */}
                      <span className={SECTION_HEADING}>
                        {isFallback
                          ? isEnriching
                            ? "Keyword candidates"
                            : "Keyword results"
                          : "Search results"}
                      </span>
                      <span className="text-[11px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-md">
                        {results.length} match
                        {results.length !== 1 ? "es" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {isEnriching && (
                        <div className="flex items-center gap-1.5 text-xs text-primary">
                          {/* Decorative: the words beside it say it. */}
                          <CorvidThinking decorative size={16} />
                          <span>Enriching with AI…</span>
                        </div>
                      )}
                      {isFallback && !isEnriching && (
                        <div className="flex items-center gap-1.5 text-xs text-warning">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>AI unavailable — showing keyword matches</span>
                        </div>
                      )}
                      {/*
                        Re-asks the question these results answer, whatever the
                        input says by now. Disabled while an answer is streaming,
                        which is the same rule the Search button follows.
                      */}
                      <button
                        onClick={handleRerun}
                        disabled={isPending || !answeredQuery}
                        aria-label="Refresh results"
                        title="Ask this question again"
                        // A quiet text button, like the status row's:
                        // it is a button, not a link.
                        className={cn(
                          BTN_QUIET,
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        <RefreshCw
                          className="w-3.5 h-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        Refresh
                      </button>
                    </div>
                  </div>

                  {/* Synthesis executive brief (Feature 6) */}
                  {aiAllowed && !isFallback && (
                    <SynthesisBar
                      query={answeredQuery}
                      contacts={results}
                      resultCount={results.length}
                    />
                  )}

                  {/* Cards — CSS stagger, no per-card Framer Motion */}
                  <div className="space-y-2">
                    {results.map((match, i) => (
                      <ResultCard
                        key={match.id}
                        match={match}
                        index={i}
                        isFallback={isFallback}
                        onClick={() => setFloatingContactId(match.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* No results. When the index is not complete, the line
                  under the search box already says so. */}
              {!isLoading &&
                hasSearched &&
                results.length === 0 &&
                !semanticSearch.isError && (
                  <EmptyState
                    icon={SearchX}
                    title="No one matches"
                    body="Try other words."
                    className="tile-enter"
                  />
                )}

              {/*
                Error state. `role="alert"` so the failure is announced the
                moment it appears (WCAG 4.1.3, technique ARIA19). The status
                region above says nothing for an error, so it is spoken
                once. The question that failed is kept by the hook, so Retry
                asks it again without reading the input, which may have
                moved on. Asking clears the error, so the button is gone
                before a second press could send the question twice.
              */}
              {semanticSearch.isError && (
                <div role="alert" className="tile-enter">
                  <EmptyState
                    icon={AlertTriangle}
                    tone="error"
                    title="Search failed"
                    body={
                      (semanticSearch.error as Error)?.message ||
                      "An unexpected error occurred."
                    }
                    action={
                      submittedQuery
                        ? {
                            label: "Retry",
                            onClick: handleRerun,
                            icon: RotateCw,
                          }
                        : undefined
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* The history. From `lg`, the rail at the right edge and the panel it
          opens over the page, which moves nothing in the column. Below it,
          a sheet. */}
      {isWide ? (
        <HistoryPane
          currentQuery={historyQuery}
          currentMode={mode}
          onSelect={handleSelectHistoryEntry}
        >
          {({ count, actions, body }) => (
            <SidePanel
              id="search-history"
              title="History"
              icon={HistoryIcon}
              open={askHistoryOpen}
              onOpenChange={setHistoryOpen}
              shortcut={historyShortcut}
              count={count}
              actions={actions}
            >
              {body}
            </SidePanel>
          )}
        </HistoryPane>
      ) : (
        <Modal
          isOpen={sheetOpen}
          onClose={closeSheet}
          ariaLabel="Search history"
          returnFocusRef={historyButtonRef}
        >
          <HistoryPane
            currentQuery={historyQuery}
            currentMode={mode}
            onClose={closeSheet}
            onSelect={(entry) => {
              closeSheet();
              handleSelectHistoryEntry(entry);
            }}
          />
        </Modal>
      )}

      {/* Floating Contact Card overlay */}
      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
        showNetworkButton
      />
    </div>
  );
};
