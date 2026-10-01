import { useState, useRef, useCallback, useEffect, useId } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isTypingTarget } from "../lib/keyboard";
import {
  Sparkles,
  AlertTriangle,
  ArrowRight,
  HistoryIcon,
  RotateCw,
  SearchX,
} from "lucide-react";
import { useSemanticSearch } from "../api";
import { useStarterDraw } from "../hooks/useStarterDraw";
import { useRecordSearch } from "../api/searchHistory";
import { usePreferences } from "../contexts/PreferencesContext";
import { useMediaQuery, WIDE_QUERY } from "../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../hooks/useSingleKeyShortcuts";
import {
  ASK_COLUMN,
  BTN_QUIET,
  filterPill,
  PAGE_TOP,
  SECTION_HEADING,
  SUGGESTION_CHIP,
} from "../lib/styles";
import { cn } from "../lib/utils";
import { FloatingContactCard } from "../components/FloatingContactCard";
import { SynthesisBar } from "../components/command-palette/SynthesisBar";
import { CorvidThinking } from "../components/brand/CorvidThinking";
import { PageHeader } from "../components/layout/PageHeader";
import { SidePanel } from "../components/layout/SidePanel";
import { usePageTitle } from "../hooks/usePageTitle";
import { NAMES } from "../lib/names";
import { ResultCard } from "./search/SearchResultCards";
import { SearchingStage, useCorvidSearchFlight } from "./search/SearchingStage";
import { InfoTip } from "../components/ui/InfoTip";
import { SearchCoverageBar, HistoryPane } from "./search";
import { InteractionSearchPanel } from "./search/InteractionSearchPanel";
import { AskSearchBox } from "./search/AskSearchBox";
import { SUGGESTION_COUNT } from "./search/suggestions";
import { Segmented } from "../components/ui/Segmented";
import { Modal } from "../components/ui/Modal";
import { LiveStatus } from "../components/ui/LiveStatus";
import { EmptyState } from "../components/ui/EmptyState";
import { peopleSearchStatus } from "../lib/searchAnnouncements";
import { useAISearchSession } from "../contexts/SessionContext";
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
  const {
    lastAISearchQuery,
    setLastAISearchQuery,
    lastAISearchData,
    setLastAISearchData,
    lastAISearchPhase,
    setLastAISearchPhase,
  } = useAISearchSession();

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
   * is what pressing Search means. The server answers it from its cache for
   * five minutes, unless the contacts changed, so the page has no Refresh
   * button: it showed the same list again. A list AI could not check is
   * never cached, and "Ask AI again" beside it asks once more.
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
      // Every match a question of facets holds, where the ids stop at 30.
      resultCount:
        semanticSearch.data.total ?? semanticSearch.data.matches?.length ?? 0,
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

  /** Bumped by Clear, so "Try asking" comes back with a new draw. */
  const [draw, setDraw] = useState(0);

  const handleClear = useCallback(() => {
    setQuery("");
    reset();
    setLastAISearchQuery("");
    setDraw((n) => n + 1);
    inputRef.current?.focus();
  }, [reset, setLastAISearchQuery]);

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
        // With focus inside the panel, H closes it too: `SidePanel` moves
        // the keyboard to the History button that brings it back.
        setHistoryOpen(!askHistoryOpen);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [singleKeys, isWide, askHistoryOpen, setHistoryOpen]);

  // Six questions drawn at random from the account's pool, which the app
  // fetched in an idle moment, so they are here with the page. A draw stays
  // put while the pool refreshes behind it, so no chip moves under a
  // pointer. A new visit, or Clear, draws again. A failed load shows none:
  // a question that finds nobody is worse than no question. The palette's AI
  // mode draws four from the same pool through the same hook.
  const suggestions = useStarterDraw(SUGGESTION_COUNT, draw);

  const handleExampleClick = useCallback(
    (exampleQuery: string) => {
      setQuery(exampleQuery);
      handleSearch(exampleQuery);
    },
    [handleSearch],
  );
  /** Names the list of suggested questions after its heading. */
  const suggestionsId = useId();

  /**
   * A question is being answered. With AI at work the local list that
   * streams first is not shown: the page waits for the answer AI verified,
   * and the corvid hunts for it meanwhile (`SearchingStage`). Without AI the
   * one answer arrives at once and never shows the stage.
   */
  const isLoading = isPending;
  const results = isLoading ? [] : (semanticSearch.data?.matches ?? []);
  const isFallback = semanticSearch.data?.fallback ?? false;
  const total = semanticSearch.data?.total ?? results.length;
  /** The question the results on screen answer. Never the input. */
  const answeredQuery = semanticSearch.data?.query ?? "";
  const networkQuery = semanticSearch.data?.facets;
  const refine = semanticSearch.data?.refine ?? [];
  const hasSearched =
    semanticSearch.isSuccess || semanticSearch.isError || results.length > 0;
  const flight = useCorvidSearchFlight(isLoading && mode === "people");

  /**
   * The one sentence a screen reader hears about this search. The thinking
   * bird, the "Searching…" line and the count pill below are what a
   * sighted person sees; none of them is announced. See
   * lib/searchAnnouncements.
   */
  const status = peopleSearchStatus({
    isLoading,
    isError: semanticSearch.isError,
    hasSearched,
    count: total,
    query: answeredQuery || submittedQuery || "",
    fallback: isFallback,
  });

  /** What the history marks as the question on screen. */
  const historyQuery =
    mode === "notes" ? (searchParams.get("q") ?? "") : answeredQuery || query;

  return (
    <div className="relative h-full flex overflow-hidden bg-surface">
      {/*
        The page scrolls as one column: the header, then the search and its
        results, in one box with one pair of gutters, so the title's left
        edge is the search box's left edge. The header scrolls away with the
        page, as it does on Pulse. The scroll padding keeps a card that Tab
        brings into view clear of the edge, so its focus ring is never cut.
        The bar's lane is kept while nothing scrolls, so the column does not
        move when the results make the page scroll.
      */}
      <div
        ref={flight.pageRef}
        className="flex-1 min-w-0 h-full overflow-y-auto scroll-py-2 [scrollbar-gutter:stable]"
      >
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
                {/* From `lg` the History button sits in the page's
                    top-right corner and opens the side panel. Below it
                    this one, the same square, opens the sheet. */}
                {!isWide && (
                  <button
                    ref={historyButtonRef}
                    type="button"
                    aria-label="History"
                    title={
                      historyShortcut
                        ? `History (${historyShortcut})`
                        : "History"
                    }
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                    onClick={() => setSheetOpen(true)}
                    className="btn-secondary btn-icon shrink-0"
                  >
                    <HistoryIcon className="w-5 h-5" aria-hidden="true" />
                  </button>
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
                {/* The search box, the one raised surface on the page. The
                    thinking bird takes the glyph's place while the answer
                    is on its way: the "Searching…" line under the box says
                    the same in words, and the status region reads it. The
                    placeholder is short enough for a 390 px window. */}
                <AskSearchBox
                  inputRef={inputRef}
                  formRef={flight.fieldRef}
                  value={query}
                  onChange={setQuery}
                  onSubmit={() => handleSearch()}
                  onClear={handleClear}
                  canClear={query.length > 0}
                  canSubmit={
                    query.trim().length >= 3 &&
                    !(isLoading && query.trim() === submittedQuery)
                  }
                  icon={Sparkles}
                  // The bird the search flight leaves and lands on. It stays
                  // while the bird is out, so it has somewhere to come home.
                  busyMark={
                    flight.perched ? (
                      <span ref={flight.perchRef} className="flex">
                        <CorvidThinking decorative size={20} />
                      </span>
                    ) : undefined
                  }
                  placeholder="Ask about your network…"
                  label="Ask anything about your network"
                />
                <SearchCoverageBar variant="row" returnFocusRef={inputRef} />
              </div>

              {/* Suggested questions, before the first search. A press
                  fills the box and asks. They arrive with the page: a
                  staggered entrance replayed on each visit, so the chips
                  were still fading in 300 ms after the page had drawn. */}
              {!hasSearched && !isLoading && suggestions.length > 0 && (
                <div className="space-y-3">
                  <h2 id={suggestionsId} className={SECTION_HEADING}>
                    Try asking
                  </h2>
                  <ul
                    aria-labelledby={suggestionsId}
                    className="flex flex-wrap gap-2"
                  >
                    {suggestions.map((q) => (
                      <li key={q}>
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
                flight.staged ? (
                  <SearchingStage
                    key="searching"
                    still={flight.still}
                    aiAllowed={aiAllowed}
                  />
                ) : null
              ) : results.length > 0 ? (
                <div key="results" className="fade-enter space-y-3">
                  {/* Results header — wraps rather than crushes on narrow screens */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      {/* A label in the muted ink, like "Try asking": blue
                          would read as a link. */}
                      <span className={SECTION_HEADING}>Search results</span>
                      <span className="text-[11px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-md">
                        {total > results.length
                          ? `${results.length} of ${total.toLocaleString()} matches`
                          : `${results.length} match${results.length !== 1 ? "es" : ""}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* The rest of a list of facets, where it can be
                          sorted and acted on. */}
                      {networkQuery && total > results.length && (
                        <Link
                          to={`/?q=${encodeURIComponent(networkQuery)}`}
                          className={BTN_QUIET}
                        >
                          See all in {NAMES.network.label}
                          <ArrowRight
                            className="w-3.5 h-3.5"
                            aria-hidden="true"
                          />
                        </Link>
                      )}
                      {/*
                        AI did not check this list. Said once in words for
                        the whole list, with the question mark every
                        unverified card carries, which explains it on a
                        tap, a click, a focus or a hover.
                      */}
                      {isFallback && (
                        <div className="flex items-center gap-0.5 text-xs font-medium text-warning">
                          <span>Not verified by AI</span>
                          <InfoTip
                            label="Why these results are not verified by AI"
                            tone="warning"
                            align="end"
                          >
                            {aiAllowed
                              ? "AI could not check these people this time, so some may not fit. They match your words or their meaning. Ask AI again to check them"
                              : "AI is off for your account, so AI did not check these people. They match your words or their meaning. Turn on AI in Settings, Privacy"}
                          </InfoTip>
                        </div>
                      )}
                      {/*
                        The one list a second ask can change: AI could not
                        check it, and the server never caches such a list.
                        It asks the question these results answer, whatever
                        the input says by now. A list AI checked would come
                        back the same, so it has no such button.
                      */}
                      {isFallback && aiAllowed && (
                        <button
                          type="button"
                          onClick={handleRerun}
                          disabled={isPending || !answeredQuery}
                          // A quiet text button, like the status row's:
                          // it is a button, not a link.
                          className={cn(
                            BTN_QUIET,
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                          )}
                        >
                          <RotateCw
                            className="w-3.5 h-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          Ask AI again
                        </button>
                      )}
                    </div>
                  </div>

                  {/* A cut list of facets offers the facets that split it.
                      A press asks the question again with one added. */}
                  {refine.length > 0 && (
                    <div
                      role="group"
                      aria-label="Narrow the list"
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span className="text-xs text-on-surface-variant">
                        Narrow
                      </span>
                      {refine.map((option) => (
                        <button
                          key={option.facet}
                          type="button"
                          aria-label={`Narrow to ${option.label}, ${option.count.toLocaleString()} people`}
                          onClick={() =>
                            handleExampleClick(
                              `${answeredQuery} ${option.facet}`,
                            )
                          }
                          className={cn("hit-area", filterPill(false))}
                        >
                          {option.label}
                          <span className="font-medium tabular-nums">
                            {option.count.toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

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
                    body="Try other words"
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
                      "An unexpected error occurred"
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

      {/* The history. From `lg`, the History button in the top-right
          corner and the panel it opens over the page, which moves nothing
          in the column. Below it, a sheet. */}
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
