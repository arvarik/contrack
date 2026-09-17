import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isTypingTarget } from "../lib/keyboard";
import {
  Sparkles,
  Search,
  X,
  Loader2,
  AlertTriangle,
  Clock,
  RefreshCw,
  RotateCw,
  SearchX,
} from "lucide-react";
import { useSemanticSearch } from "../api";
import { useRecordSearch } from "../api/searchHistory";
import { usePreferences } from "../contexts/PreferencesContext";
import { useMediaQuery, WIDE_QUERY } from "../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../hooks/useSingleKeyShortcuts";
import { PAGE_TITLE, SECTION_BG } from "../lib/styles";
import { cn } from "../lib/utils";
import { tileDelay } from "../lib/motion";
import { FloatingContactCard } from "../components/FloatingContactCard";
import { SynthesisBar } from "../components/command-palette/SynthesisBar";
import { usePageTitle } from "../hooks/usePageTitle";
import { NAMES } from "../lib/names";
import { ResultCard, ShimmerCard } from "./search/SearchResultCards";
import { SearchCoverageBar, HistoryPane } from "./search";
import { InteractionSearchPanel } from "./search/InteractionSearchPanel";
import { Segmented } from "../components/ui/Segmented";
import { IconButton } from "../components/ui/IconButton";
import { Modal } from "../components/ui/Modal";
import { LiveStatus } from "../components/ui/LiveStatus";
import { EmptyState } from "../components/ui/EmptyState";
import { peopleSearchStatus } from "../lib/searchAnnouncements";
import { useSession } from "../contexts/SessionContext";
import type { HistoryEntry } from "../../shared/searchHistory";

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

const EXAMPLE_QUERIES = [
  "Who do I know in London working in FinTech?",
  "Who likes espresso?",
  "Who haven't I contacted in over 3 months?",
  "Who works at a startup as a designer?",
  "Who do I know in venture capital?",
  "Find people interested in AI or machine learning",
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
  const askHistoryOpen = preferences.askHistoryOpen;
  const isWide = useMediaQuery(WIDE_QUERY);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const singleKeys = useSingleKeyShortcuts();
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

  usePageTitle(mode === "notes" ? "Search Notes" : NAMES.ask.title);

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

  const handleToggleHistory = useCallback(() => {
    if (isWide) {
      setPreference("askHistoryOpen", !askHistoryOpen);
    } else {
      setMobileHistoryOpen((prev) => !prev);
    }
  }, [isWide, askHistoryOpen, setPreference]);

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
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (
        e.key.toLowerCase() === "h" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (!singleKeys) return;
        e.preventDefault();
        handleToggleHistory();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [singleKeys, handleToggleHistory]);

  const handleExampleClick = useCallback(
    (exampleQuery: string) => {
      setQuery(exampleQuery);
      handleSearch(exampleQuery);
    },
    [handleSearch],
  );

  const results = semanticSearch.data?.matches ?? [];
  const isFallback = semanticSearch.data?.fallback ?? false;
  /** The question the results on screen answer. Never the input. */
  const answeredQuery = semanticSearch.data?.query ?? "";
  const isLoading = isPending && results.length === 0;
  const isEnriching = semanticSearch.phase === "enriching";
  const hasSearched =
    semanticSearch.isSuccess || semanticSearch.isError || results.length > 0;

  /**
   * The one sentence a screen reader hears about this search. The spinner,
   * the "Searching..." line and the count pill below are what a sighted
   * person sees; none of them is announced. See lib/searchAnnouncements.
   */
  const status = peopleSearchStatus({
    isLoading,
    isEnriching,
    isError: semanticSearch.isError,
    hasSearched,
    count: results.length,
    query: answeredQuery || submittedQuery,
    fallback: isFallback,
  });

  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden bg-surface">
      {/* Primary column (Header + scrolling body) */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header
          className={cn(
            SECTION_BG,
            "px-4 sm:px-6 py-5 sm:py-6 shrink-0 flex flex-wrap items-center justify-between gap-4",
          )}
        >
          <div>
            <h1 className={cn(PAGE_TITLE, "flex items-center gap-3")}>
              <div className="p-2 bg-primary/10 rounded-xl shrink-0">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              {NAMES.ask.label}
            </h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              {mode === "notes"
                ? "Find what was said, and when"
                : NAMES.ask.description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Segmented
              options={MODES}
              value={mode}
              onChange={setMode}
              label="What to search"
            />
            {mode === "people" && <SearchCoverageBar compact />}
            <IconButton
              ref={historyToggleRef}
              aria-label="Search history"
              aria-pressed={askHistoryOpen}
              onClick={handleToggleHistory}
              tone={askHistoryOpen && isWide ? "primary" : "ghost"}
            >
              <Clock className="w-5 h-5" />
            </IconButton>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8 pb-28 md:pb-8">
            {mode === "notes" ? (
              <InteractionSearchPanel />
            ) : (
              <>
                <LiveStatus message={status} label="Search status" />

                {/* Search Input — the button drops below the field on phones */}
                <div className="relative">
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-surface-container-lowest rounded-2xl shadow-sm px-4 sm:px-5 py-2 sm:py-4 focus-within:ring-2 focus-within:ring-primary/30 focus-within:shadow-md transition-[box-shadow] duration-200">
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
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
                      // 44px tall on a phone, the touch floor; the row's
                      // padding shrinks there to make up for it.
                      className="flex-1 min-w-0 h-11 sm:h-auto bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-on-surface-variant text-base sm:text-lg"
                    />
                    {/*
                Reserved slot, not an AnimatePresence exit. Mounting and
                unmounting the clear button changed the row's width mid-typing
                and nudged the caret; now the space is always there and only
                the button's opacity changes.
              */}
                    <button
                      onClick={handleClear}
                      tabIndex={query.length > 0 ? 0 : -1}
                      aria-hidden={query.length === 0}
                      className={cn(
                        "hit-area p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-opacity duration-150 shrink-0",
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
                </div>

                {/* Example queries — only shown before first search */}
                {!hasSearched && !isLoading && (
                  <div className="space-y-4">
                    <EmptyState
                      icon={Sparkles}
                      title="Ask anything"
                      body="Semantic search reads names, roles, notes and interests."
                      className="py-4"
                    />
                    <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                      Try asking...
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {EXAMPLE_QUERIES.map((q, i) => (
                        <button
                          key={q}
                          style={{ animationDelay: tileDelay(i) }}
                          onClick={() => handleExampleClick(q)}
                          className="tile-enter text-left px-4 py-3 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md hover:bg-primary/5 text-sm text-on-surface-variant hover:text-primary transition-[background-color,box-shadow,color] duration-200 group"
                        >
                          <span className="text-primary group-hover:text-primary mr-1.5 font-bold">
                            ?
                          </span>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/*
            Shimmer and results share one keyed slot and crossfade with CSS.

            This used to be `<AnimatePresence mode="popLayout">`, which yanks the
            exiting shimmer into `position: absolute` for the length of its exit
            — and for those frames the shimmer sits on top of the incoming cards
            at a stale width. A keyed `.fade-enter` swaps in one commit: the
            outgoing tree is gone before the new one paints, so there is nothing
            to overlap.
          */}
                {isLoading ? (
                  <div key="shimmer" className="fade-enter space-y-3">
                    <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-widest mb-4">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Searching...
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
                        <span className="text-xs font-bold uppercase tracking-widest text-primary">
                          {isFallback
                            ? isEnriching
                              ? "Keyword candidates"
                              : "Keyword results"
                            : "Search results"}
                        </span>
                        <span className="text-[11px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
                          {results.length} match
                          {results.length !== 1 ? "es" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {isEnriching && (
                          <div className="flex items-center gap-1.5 text-xs text-primary">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Enriching with AI…</span>
                          </div>
                        )}
                        {isFallback && !isEnriching && (
                          <div className="flex items-center gap-1.5 text-xs text-warning">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>
                              AI unavailable — showing keyword matches
                            </span>
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
                          className="hit-area flex items-center gap-1 text-xs text-primary hover:underline disabled:text-on-surface-variant disabled:no-underline disabled:cursor-not-allowed"
                        >
                          <RefreshCw className="w-3 h-3 shrink-0" />
                          Refresh
                        </button>
                      </div>
                    </div>

                    {/* Synthesis executive brief (Feature 6) */}
                    {!isFallback && (
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

                {/* No results */}
                {!isLoading &&
                  hasSearched &&
                  results.length === 0 &&
                  !semanticSearch.isError && (
                    <EmptyState
                      icon={SearchX}
                      title="No one matches"
                      body="Try other words, or check the coverage below."
                      className="tile-enter"
                    >
                      <div className="w-full max-w-md pt-2 text-left">
                        <SearchCoverageBar />
                      </div>
                    </EmptyState>
                  )}

                {/*
                Error state. `role="alert"` so the failure is announced the
                moment it appears (WCAG 4.1.3, technique ARIA19). The status
                region above says nothing for an error, so it is spoken once.
              */}
                {semanticSearch.isError && (
                  <div
                    role="alert"
                    className="tile-enter flex flex-col items-center justify-center py-16 text-center"
                  >
                    <div className="p-4 bg-rose-500/10 rounded-2xl mb-4">
                      <AlertTriangle className="w-10 h-10 text-error" />
                    </div>
                    <p className="font-bold text-on-surface mb-1">
                      Search failed
                    </p>
                    <p className="text-sm text-on-surface-variant">
                      {(semanticSearch.error as Error)?.message ||
                        "An unexpected error occurred."}
                    </p>
                    {/*
                The question that failed is kept by the hook, so this asks it
                again without reading the input, which may have moved on.
              */}
                    {submittedQuery && (
                      <button
                        onClick={handleRerun}
                        disabled={isPending}
                        className="btn-primary mt-4"
                      >
                        <RotateCw className="w-4 h-4" />
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Desktop History Aside (on lg and up when askHistoryOpen is true) */}
      {askHistoryOpen && (
        <aside
          aria-label="Search history"
          className="hidden lg:flex flex-col w-[320px] shrink-0 bg-surface-container-low overflow-y-auto"
        >
          <HistoryPane
            currentQuery={answeredQuery || query}
            currentMode={mode}
            onSelect={handleSelectHistoryEntry}
          />
        </aside>
      )}

      {/* Mobile History Bottom Sheet (below lg) */}
      <Modal
        isOpen={mobileHistoryOpen}
        onClose={() => {
          setMobileHistoryOpen(false);
          historyToggleRef.current?.focus();
        }}
        ariaLabel="Search history"
      >
        <div className="p-2 -m-2">
          <HistoryPane
            currentQuery={answeredQuery || query}
            currentMode={mode}
            onSelect={(entry) => {
              setMobileHistoryOpen(false);
              historyToggleRef.current?.focus();
              handleSelectHistoryEntry(entry);
            }}
          />
        </div>
      </Modal>

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
