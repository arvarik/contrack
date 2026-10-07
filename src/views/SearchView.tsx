import { useState, useRef, useCallback, useEffect, useId } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Sparkles,
  Upload,
  AlertCircle,
  ArrowRight,
  HistoryIcon,
  MapPin,
  RotateCw,
  SearchX,
} from "lucide-react";
import { useStarterDraw } from "../hooks/useStarterDraw";
import { useRecordSearch } from "../api/searchHistory";
import { useStarterQuestions } from "../api";
import { isPageKeyTaken } from "../lib/keyboard";
import { touchFirst } from "../lib/platform";
import { useRovingFocus } from "./search/useRovingFocus";
import { usePreferences } from "../contexts/PreferencesContext";
import { useMediaQuery, WIDE_QUERY } from "../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../hooks/useSingleKeyShortcuts";
import {
  ASK_COLUMN,
  BTN_QUIET,
  PAGE_TOP,
  SECTION_HEADING,
  SUGGESTION_CHIP,
} from "../lib/styles";
import { cn, errorText } from "../lib/utils";
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

// The Ask page. People is the AI search over contacts, and Notes is the local
// search over what was written about them. The mode lives in the URL as
// `?mode=notes`, so the command palette can link to a note search and Back
// returns to it.

type SearchMode = "people" | "notes";

const MODES: readonly { value: SearchMode; label: string }[] = [
  { value: "people", label: "People" },
  { value: "notes", label: "Notes" },
];

export const SearchView = () => {
  const { lastAISearchQuery, setLastAISearchQuery, semanticSearch } =
    useAISearchSession();

  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The editable input, restored from `lastAISearchQuery` on the way back.
   * The question the results answer is `semanticSearch.data.query`.
   */
  const [query, setQuery] = useState(lastAISearchQuery);

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

  // Focus on arrival on a desktop only: on a touch screen it opens the
  // keyboard before a person chooses to type.
  useEffect(() => {
    if (touchFirst()) return;
    inputRef.current?.focus();
  }, []);

  /** A question under three letters was asked: the line under the box says why. */
  const [tooShort, setTooShort] = useState(false);
  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    setTooShort(false);
  }, []);

  /**
   * Ask a question. The one guard skips the same question while it is in
   * flight, since Enter and Search both land here. It reads the hook's
   * question, so it clears with the search: a ref of the view's own would
   * survive Clear and block asking the same question again. A question with
   * its results on screen runs again, and the server answers it from a
   * five-minute cache unless the contacts changed, so there is no Refresh.
   */
  const handleSearch = useCallback(
    (searchQuery?: string) => {
      const q = (searchQuery ?? query).trim();
      if (q.length < 3) {
        setTooShort(q.length > 0);
        return;
      }
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

  // Ask the `?q=` question on mount, through handleSearch, so it is recorded
  // and restored like a typed one. In Notes mode `q` belongs to the panel.
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
    changeQuery("");
    reset();
    setLastAISearchQuery("");
    setDraw((n) => n + 1);
    inputRef.current?.focus();
  }, [changeQuery, reset, setLastAISearchQuery]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!singleKeys) return;
      // A key in a field, a dialog or a menu is theirs, so H in the history's
      // Clear confirmation does not close the pane under it.
      if (isPageKeyTaken(e)) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key.toLowerCase() === "h") {
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

  // A draw stays put while the pool refreshes, so no chip moves under a
  // pointer. A failed load shows none: a question that finds nobody is worse
  // than no question.
  const suggestions = useStarterDraw(SUGGESTION_COUNT, draw);
  // The pool comes back empty only for a network with no one in it.
  const starter = useStarterQuestions();
  const nobodyToAsk =
    starter.isSuccess && (starter.data?.questions.length ?? 0) === 0;

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
   * With AI, the local list that streams first is not shown: the page waits
   * for the verified answer while the corvid hunts (`SearchingStage`).
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
  const roving = useRovingFocus(results.length);
  const flight = useCorvidSearchFlight(isLoading && mode === "people");

  /**
   * The one sentence a screen reader hears about this search. The bird, the
   * "Searching…" line and the count pill are not announced.
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
      {/* One scrolling column, header included, so the title and the search
          box share a left edge. The scroll padding keeps a focus ring clear
          of the edge, and the stable gutter keeps the column still when the
          results make the page scroll. */}
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
            // The switch stays where it was clicked in both modes. On a
            // phone the controls fill the row under the title.
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

              <div className="space-y-3">
                {/* The bird replaces the glyph while the answer is on its
                    way, and the status region says so in words. The
                    placeholder fits a 390 px window. */}
                <AskSearchBox
                  inputRef={inputRef}
                  formRef={flight.fieldRef}
                  value={query}
                  onChange={changeQuery}
                  onSubmit={() => handleSearch()}
                  onClear={handleClear}
                  canClear={query.length > 0}
                  // A short question still submits, so the line under the
                  // box can say why it was not asked.
                  canSubmit={
                    query.trim().length > 0 &&
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
                  label="Ask about your network"
                />
                {tooShort && (
                  <p
                    role="status"
                    className="px-1 text-sm text-on-surface-variant"
                  >
                    Type 3 or more letters to ask
                  </p>
                )}
                <SearchCoverageBar variant="row" returnFocusRef={inputRef} />
              </div>

              {/* Suggested questions, before the first search. No staggered
                  entrance: it kept the chips fading in 300 ms after the page
                  drew. */}
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

              {/* No question to suggest: say what to ask, or, with no one
                  in the network yet, how to bring people in. */}
              {!hasSearched &&
                !isLoading &&
                suggestions.length === 0 &&
                (starter.isSuccess || starter.isError) &&
                (nobodyToAsk ? (
                  <EmptyState
                    icon={Upload}
                    title="No one to ask about yet"
                    body="Import your contacts, then ask about them here"
                    action={{
                      label: "Import contacts",
                      onClick: () => navigate("/?import=1"),
                    }}
                  />
                ) : (
                  <p className="px-1 text-sm text-on-surface-variant">
                    Ask in your own words, such as &ldquo;who works in
                    design&rdquo; or &ldquo;who did I meet in Lisbon&rdquo;
                  </p>
                ))}

              {/* A keyed `.fade-enter` swaps the shimmer for the results in one
                  commit. `AnimatePresence mode="popLayout"` would keep the
                  exiting shimmer on top of the new cards at a stale width. */}
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
                      {/* A list of facets shows every match, and AI's
                          answer shows its people. */}
                      <Link
                        to={
                          networkQuery
                            ? `/map?q=${encodeURIComponent(networkQuery)}`
                            : `/map?people=${results.map((m) => m.id).join(",")}`
                        }
                        className={BTN_QUIET}
                      >
                        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                        Show on map
                      </Link>
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
                      {/* Said once for the whole list, with the question mark
                          every unverified card carries. */}
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
                              : "AI is off for your account, so AI did not check these people. They match your words or their meaning. Turn on AI in Settings → Privacy and AI"}
                          </InfoTip>
                        </div>
                      )}
                      {/* Only an unchecked list can change on a second ask: the
                          server never caches it. It asks the question these
                          results answer, not the input. */}
                      {isFallback && aiAllowed && (
                        <button
                          type="button"
                          onClick={handleRerun}
                          disabled={isPending || !answeredQuery}
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
                      A press asks the question again with one added, so
                      each is a suggested question's chip. */}
                  {refine.length > 0 && (
                    <div
                      role="group"
                      aria-label="Narrow the list"
                      className="flex flex-wrap items-center gap-2"
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
                          className={cn(
                            SUGGESTION_CHIP,
                            "flex items-center gap-1.5",
                          )}
                        >
                          {option.label}
                          <span className="font-semibold tabular-nums">
                            {option.count.toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {aiAllowed && !isFallback && (
                    <SynthesisBar
                      query={answeredQuery}
                      contacts={results}
                      resultCount={results.length}
                    />
                  )}

                  {/* A CSS stagger, not per-card Framer Motion */}
                  <div ref={roving.listRef} className="space-y-2">
                    {results.map((match, i) => (
                      <ResultCard
                        key={match.id}
                        match={match}
                        index={i}
                        isFallback={isFallback}
                        onClick={() => setFloatingContactId(match.id)}
                        itemProps={roving.itemProps(i)}
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

              {/* `role="alert"` announces the failure once (WCAG 4.1.3,
                  ARIA19): the status region says nothing for an error. Try
                  again asks the failed question the hook kept, not the
                  input. Asking clears the error, so a second press cannot
                  send it twice. */}
              {semanticSearch.isError && (
                <div role="alert" className="tile-enter">
                  <EmptyState
                    icon={AlertCircle}
                    tone="error"
                    title="Could not search"
                    body={errorText(semanticSearch.error)}
                    action={
                      submittedQuery
                        ? {
                            label: "Try again",
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

      {/* The history: from `lg`, a panel over the page that moves nothing in
          the column. Below it, a sheet. */}
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

      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
        showNetworkButton
      />
    </div>
  );
};
