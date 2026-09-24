/**
 * InteractionSearchPanel — the Notes mode of the search page.
 *
 * "Who discussed hiring last month?" → the notes that say so, each with the
 * person it is about, the date, and the passage that matched. Everything is
 * local: the server runs FTS5 over the note index and no model is called, so
 * the same question over the same notes gives the same page every time.
 *
 * The page has People's shape and feel: the same search box with the same
 * search button, the same "Searching…" line and shimmer while a first answer
 * is on its way, and the same results header. Enter or the button searches,
 * as on People. The box used to search as the words were typed, with no
 * button to press, which People had.
 *
 * The state lives in the URL (`q`, `from`, `to`, `type`), so Back returns to
 * the same search and a link to it can be shared. The input is the one thing
 * kept locally, and it reaches `q` when it is searched. The filters under the
 * box, the kind and the period, apply the moment they change.
 *
 * **What stays on screen while an answer loads.** The last answer, notes or
 * "No notes match", stays where it is until the next one arrives, and the
 * next one replaces it in place: a card that is in both answers stays put,
 * and only a new card fades in. A search slower than 150 ms dims the old
 * answer and turns the box's glyph into a spinner (`useLoadingShown`), and
 * the new answer ends both at once. Only a first search, with nothing on
 * screen yet, shows the "Searching…" line and the shimmer, and they stay at
 * least 400 ms so they never blink. The panel used to remount the old cards
 * the moment the words changed, so they vanished and faded back in before
 * the answer came, to drop the answer on screen for a shimmer after 150 ms,
 * to hold a slow answer back behind the shimmer, and to spin the glyph for
 * one frame on every fast search.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActivitySquare,
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Handshake,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  SearchX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useInteractionSearch } from "../../api/search";
import { useRecordSearch } from "../../api/searchHistory";
import { useLoadingShown } from "../../hooks/useLoadingShown";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { isTypingTarget } from "../../lib/keyboard";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { formatDay, formatRelative, parseServerTime } from "../../lib/datetime";
import {
  CARD_INTERACTIVE,
  SECTION_HEADING,
  filterPill,
} from "../../lib/styles";
import { noteSearchStatus } from "../../lib/searchAnnouncements";
import { cn } from "../../lib/utils";
import { LiveStatus } from "../../components/ui/LiveStatus";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Select, type SelectOption } from "../../components/ui/Select";
import type { HighlightRange, InteractionSearchHit } from "../../types";
import { AskSearchBox } from "./AskSearchBox";
import { ShimmerCard } from "./SearchResultCards";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  call: Phone,
  meeting: Handshake,
  email: Mail,
  message: MessageSquare,
  sms: MessageSquare,
};

/**
 * The kinds of note, for the first chip under the box. Each names its
 * choice with its glyph, so the chip reads "Calls" with a phone once chosen.
 */
const TYPES: SelectOption[] = [
  { value: "", label: "All kinds" },
  { value: "note", label: "Notes", icon: TYPE_ICONS.note },
  { value: "call", label: "Calls", icon: TYPE_ICONS.call },
  { value: "meeting", label: "Meetings", icon: TYPE_ICONS.meeting },
  { value: "email", label: "Emails", icon: TYPE_ICONS.email },
  { value: "message", label: "Messages", icon: TYPE_ICONS.message },
];

const PAGE_SIZE = 20;

type Period = "any" | "7d" | "30d" | "month" | "year" | "custom";

const PERIODS: { value: Exclude<Period, "custom">; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "Last month" },
  { value: "year", label: "This year" },
];

/** The periods as one chip's list, for a phone, where six chips took three rows. */
const PERIOD_OPTIONS: SelectOption<Period>[] = [
  ...PERIODS,
  { value: "custom", label: "Custom" },
];

// ─── Dates ────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar date in the reader's own zone, the form the API takes. */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

/** The inclusive calendar dates a preset stands for, today being the reader's today. */
function presetRange(period: Exclude<Period, "custom" | "any">): {
  from: string;
  to: string;
} {
  const today = daysAgo(0);
  switch (period) {
    case "7d":
      return { from: localDate(daysAgo(6)), to: localDate(today) };
    case "30d":
      return { from: localDate(daysAgo(29)), to: localDate(today) };
    case "month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: localDate(first), to: localDate(last) };
    }
    case "year":
      return {
        from: localDate(new Date(today.getFullYear(), 0, 1)),
        to: localDate(today),
      };
  }
}

/** Which preset the URL's dates are, or `custom` when they are somebody's own. */
function periodOf(from: string, to: string): Period {
  if (!from && !to) return "any";
  for (const { value } of PERIODS) {
    if (value === "any") continue;
    const range = presetRange(value);
    if (range.from === from && range.to === to) return value;
  }
  return "custom";
}

/** "Aug 1 – Aug 31, 2026" for an instant range whose end is exclusive. */
function describeRange(from: string | null, to: string | null): string {
  const start = from ? parseServerTime(from) : null;
  const end = to ? parseServerTime(to) : null;
  // The medium date that formatDay prints. The bounds here are Date values
  // and not API strings, so the options are the same and the call is direct.
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, { dateStyle: "medium" });
  // The end is exclusive, so the last day inside the range is a moment before.
  const lastDay = end ? new Date(end.getTime() - 1) : null;
  if (start && lastDay) return `${day(start)} – ${day(lastDay)}`;
  if (start) return `since ${day(start)}`;
  if (lastDay) return `until ${day(lastDay)}`;
  return "";
}

// ─── Highlighted text ─────────────────────────────────────────────────────────

/**
 * Text with the matched terms marked. Ranges come from the server, sorted.
 * Each match is a plain `mark`: the base layer paints the highlighter and
 * the ink.
 */
export const Highlighted = ({
  text,
  ranges,
}: {
  text: string;
  ranges: HighlightRange[];
}) => {
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start < cursor || end <= start || end > text.length) return;
    if (start > cursor)
      parts.push(
        <React.Fragment key={`t${i}`}>
          {text.slice(cursor, start)}
        </React.Fragment>,
      );
    parts.push(<mark key={`m${i}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length)
    parts.push(
      <React.Fragment key="tail">{text.slice(cursor)}</React.Fragment>,
    );
  return <>{parts}</>;
};

// ─── Result card ──────────────────────────────────────────────────────────────

const HitCard = ({
  hit,
  index,
  onOpen,
}: {
  hit: InteractionSearchHit;
  index: number;
  onOpen: (hit: InteractionSearchHit) => void;
}) => {
  const Icon = TYPE_ICONS[hit.type] ?? ActivitySquare;
  return (
    <div
      className="result-card-enter"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(hit)}
        className={cn(
          CARD_INTERACTIVE,
          "w-full text-left flex items-start gap-4",
        )}
      >
        <img
          src={hit.contact.avatarUrl || fallbackAvatarUrl(hit.contact.name)}
          alt=""
          className="w-11 h-11 rounded-full bg-surface-container-high object-cover shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-bold text-on-surface truncate">
              {hit.contact.name}
            </span>
            {(hit.contact.role || hit.contact.company) && (
              <span className="text-xs text-on-surface-variant truncate">
                {[hit.contact.role, hit.contact.company]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-on-surface min-w-0">
            <Icon className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
            <span className="font-semibold truncate">
              <Highlighted text={hit.title} ranges={hit.highlights.title} />
            </span>
          </div>
          {hit.excerpt && (
            <p className="text-sm text-on-surface-variant leading-snug line-clamp-3">
              <Highlighted text={hit.excerpt} ranges={hit.highlights.excerpt} />
            </p>
          )}
          <time
            dateTime={parseServerTime(hit.date)?.toISOString()}
            title={formatDay(hit.date)}
            className="text-xs text-on-surface-variant mt-0.5"
          >
            {formatDay(hit.date)} · {formatRelative(hit.date)}
          </time>
        </div>
      </button>
    </div>
  );
};

// ─── Panel ────────────────────────────────────────────────────────────────────

export const InteractionSearchPanel = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const q = searchParams.get("q") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const type = searchParams.get("type") ?? "";
  const [text, setText] = useState(q);
  const [mode, setMode] = useState<"auto" | "all" | "any">("auto");
  const [sort, setSort] = useState<"relevance" | "date">("relevance");
  // The page of results belongs to one search: a new question or filter
  // starts from the first page. Worked out as the panel renders, so the
  // query never runs once with the old offset first, which an effect that
  // reset it after the render did.
  const searchKey = [q, from, to, type, mode, sort].join("\u0000");
  const [page, setPage] = useState({ key: searchKey, offset: 0 });
  const offset = page.key === searchKey ? page.offset : 0;
  const setOffset = (next: number) => setPage({ key: searchKey, offset: next });
  /**
   * Whether the reader asked for the date fields. Dates that happen to equal
   * a preset are shown as that preset until Custom is chosen, and Custom
   * stays open until a preset is chosen, so the fields do not vanish under
   * a reader who has just typed the last day of last month into them.
   */
  const [customOpen, setCustomOpen] = useState(false);

  /** Write one or more fields to the URL, dropping the ones set to "". */
  const update = useCallback(
    (fields: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(fields)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // The box follows a question that arrives from elsewhere: a history entry,
  // or Back to a search.
  const prevQRef = useRef(q);
  useEffect(() => {
    if (q !== prevQRef.current) {
      prevQRef.current = q;
      setText(q);
    }
  }, [q]);

  /**
   * Focus the question on arrival, unless the reader arrived by arrow key on
   * the People / Notes switch. A radiogroup promises that the arrows move
   * focus between its options; a field that takes focus the moment an
   * option is chosen breaks that promise, and the next arrow press would
   * type into the field instead of moving on.
   */
  useEffect(() => {
    if (document.activeElement?.getAttribute("role") === "radio") return;
    inputRef.current?.focus();
  }, []);

  const singleKeys = useSingleKeyShortcuts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (!singleKeys) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [singleKeys]);

  const params = useMemo(
    () => ({
      q,
      from: from || undefined,
      to: to || undefined,
      type: type || undefined,
      sort,
      mode,
      limit: PAGE_SIZE,
      offset,
    }),
    [q, from, to, type, sort, mode, offset],
  );
  const search = useInteractionSearch(params);
  const result = search.data;
  const hits = result?.hits ?? [];
  const total = result?.total ?? 0;
  const period: Period = customOpen ? "custom" : periodOf(from, to);
  // A date phrase in the words ("coffee last month") sets the range, and
  // the result says so in its own chip. "Any time" pressed beside that chip
  // would say the opposite, so no period shows pressed then.
  const phraseSetsRange =
    period === "any" && result?.query.range?.source === "phrase";
  const shownPeriod: Period | null = phraseSetsRange ? null : period;
  const hasSearch = Boolean(q || from || to || type);
  const showModeToggle = (result?.query.tokens.length ?? 0) >= 2;

  /**
   * The answer on screen belongs to an earlier search while this one
   * loads: the query keeps it (`keepPreviousData`), so a new question or
   * filter does not blank the page. Past 150 ms the old answer dims and
   * the glyph spins. With nothing on screen yet, the shimmer shows instead,
   * and it holds for 400 ms once it shows, so it never blinks: the answer
   * waits for it, and it goes up only once per wait.
   */
  const busy = useLoadingShown(hasSearch && search.isFetching);
  const stale = Boolean(result) && search.isPlaceholderData;
  const [shimmer, setShimmer] = useState(false);
  if (busy && !result && !shimmer) setShimmer(true);
  if (!busy && shimmer) setShimmer(false);
  const dimmed = busy && stale;

  const recordSearch = useRecordSearch();
  const lastRecordedNotesQueryRef = useRef<string | null>(null);

  // Record each question once, when its own answer arrives: not the answer
  // to the question before it, which the query shows while this one loads.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    if (!search.isSuccess || search.isPlaceholderData || !result) return;
    if (lastRecordedNotesQueryRef.current === trimmed) return;
    lastRecordedNotesQueryRef.current = trimmed;
    recordSearch.mutate({
      query: trimmed,
      mode: "notes",
      resultCount: result.total,
      resultIds: (result.hits ?? []).slice(0, 30).map((h) => h.contactId),
    });
  }, [q, search.isSuccess, search.isPlaceholderData, result, recordSearch]);

  /**
   * Search for the words in the box. The words go to the URL, which is what
   * the query reads, so Back returns to them. The same words again search
   * again.
   */
  const submit = () => {
    const words = text.trim();
    if (words === q) void search.refetch();
    else update({ q: words });
  };

  const choosePeriod = (next: Period) => {
    setCustomOpen(next === "custom");
    if (next === "any") update({ from: "", to: "" });
    else if (next === "custom") {
      const range = presetRange("30d");
      update({ from: from || range.from, to: to || range.to });
    } else update(presetRange(next));
  };

  /** Empty the box and every filter, and with them what they found. */
  const clear = () => {
    setText("");
    setCustomOpen(false);
    update({ q: "", from: "", to: "", type: "" });
    inputRef.current?.focus();
  };

  const open = (hit: InteractionSearchHit) => {
    navigate(`/contact/${hit.contactId}?interaction=${hit.id}`);
  };

  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + hits.length, total);
  const showAnswer = !shimmer && hasSearch && result !== undefined;

  /**
   * The one sentence a screen reader hears about this search. The loading
   * state and the count over the results are what a sighted person sees.
   * See lib/searchAnnouncements for the wording.
   */
  const status = noteSearchStatus({
    isFetching: search.isFetching,
    isSuccess: search.isSuccess,
    isError: search.isError,
    hasSearch,
    total,
    query: q,
  });

  return (
    <div className="space-y-6">
      <LiveStatus message={status} label="Search status" />

      {/*
        The box and, under it, what narrows the search: the kind of note,
        then the period. The same box as People's, so switching modes moves
        nothing. A spinner takes the note's place while a search runs, not
        the thinking bird: no model reads the notes, the server matches
        words.
      */}
      <div className="space-y-3">
        <AskSearchBox
          inputRef={inputRef}
          value={text}
          onChange={setText}
          onSubmit={submit}
          onClear={clear}
          canClear={text.length > 0 || hasSearch}
          canSubmit={text.trim().length > 0}
          icon={FileText}
          busyMark={
            shimmer || dimmed ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : undefined
          }
          placeholder="Search your notes…"
          label="Search your notes"
        />

        {/*
          The filters, as one row of chips. The kind comes first, a chip that
          opens a list and names its choice, the way Gmail and Drive put
          "Type" first under their search boxes: what, then when. A kind
          other than all takes the chip's selected tint, like a pressed
          period. On a phone the six periods fold into one chip of the same
          kind, so the two filters share one row: six chips took three.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            variant="ghost"
            label="Kind of note"
            value={type}
            onChange={(next) => update({ type: next })}
            options={TYPES}
            className={cn(
              filterPill(type !== ""),
              "hit-area min-h-[44px] sm:min-h-[36px]",
            )}
          />
          <span aria-hidden="true" className="w-1 shrink-0" />
          <Select<Period>
            variant="ghost"
            label="Period"
            value={shownPeriod ?? "any"}
            onChange={choosePeriod}
            options={PERIOD_OPTIONS}
            wrapperClassName="sm:hidden"
            className={cn(
              filterPill(shownPeriod !== null && shownPeriod !== "any"),
              "hit-area min-h-[44px]",
            )}
          />
          <div className="hidden sm:contents">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => choosePeriod(p.value)}
                className={cn(
                  filterPill(shownPeriod === p.value),
                  "min-h-[36px]",
                )}
                aria-pressed={shownPeriod === p.value}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => choosePeriod("custom")}
              className={cn(filterPill(period === "custom"), "min-h-[36px]")}
              aria-pressed={period === "custom"}
            >
              Custom
            </button>
          </div>
        </div>

        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-xs font-bold text-on-surface-variant">
              From
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => update({ from: e.target.value })}
                className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface min-h-[44px] sm:min-h-[36px]"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-on-surface-variant">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => update({ to: e.target.value })}
                className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface min-h-[44px] sm:min-h-[36px]"
              />
            </label>
          </div>
        )}
      </div>

      {/*
        A first search, past a short wait: the line and the shimmer that
        People shows, in one slot with the answer, so one swaps for the
        other in a single commit.
      */}
      {shimmer && (
        <div className="fade-enter space-y-3">
          <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-[0.08em] mb-4">
            {/* Decorative: the word beside it says the same thing. */}
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Searching…
          </div>
          <ShimmerCard delay={0} />
          <ShimmerCard delay={0.08} />
          <ShimmerCard delay={0.16} />
        </div>
      )}

      {/* The last answer: the header, the notes, the pages or the empty
          state. It dims while a slow search replaces it. */}
      {showAnswer && result && (
        <div
          aria-busy={dimmed || undefined}
          className={cn("space-y-6 transition-opacity", dimmed && "opacity-60")}
        >
          {/* What the server understood, in the results' header: the count
              in the pill People uses, the date range it read, and the ways
              to match and order. With no notes found, only what still
              helps stays: the range it read, and the way back from "All
              words" a person chose. */}
          {(total > 0 ||
            result.query.range ||
            (showModeToggle && mode === "all")) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              {total > 0 && (
                <div className="flex items-center gap-2">
                  {/* A label in the muted ink, as on People: blue would
                        read as a link. */}
                  <span className={SECTION_HEADING}>Search results</span>
                  <span className="text-[11px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-md">
                    {total} note{total === 1 ? "" : "s"}
                  </span>
                </div>
              )}
              {result.query.range && (
                <span className="inline-flex items-center gap-1.5 bg-surface-container-high text-on-surface px-2.5 py-1 rounded-md">
                  <CalendarDays className="w-3 h-3 text-primary" aria-hidden />
                  {result.query.phrase && result.query.range.source === "phrase"
                    ? `“${result.query.phrase}” → `
                    : ""}
                  {describeRange(
                    result.query.range.from,
                    result.query.range.to,
                  )}
                </span>
              )}
              {total > 0 &&
                result.query.mode === "any" &&
                showModeToggle &&
                mode === "auto" && (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
                    No note has every word, showing notes with any of them
                  </span>
                )}
              {showModeToggle && (total > 0 || mode === "all") && (
                <div
                  className="inline-flex items-center gap-1 ml-auto"
                  role="group"
                  aria-label="How to match the words"
                >
                  <button
                    type="button"
                    onClick={() => setMode(mode === "all" ? "auto" : "all")}
                    className={cn(
                      filterPill(result.query.mode === "all"),
                      "min-h-[44px] sm:min-h-[36px]",
                    )}
                    aria-pressed={result.query.mode === "all"}
                  >
                    All words
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(mode === "any" ? "auto" : "any")}
                    className={cn(
                      filterPill(result.query.mode === "any"),
                      "min-h-[44px] sm:min-h-[36px]",
                    )}
                    aria-pressed={result.query.mode === "any"}
                  >
                    Any word
                  </button>
                </div>
              )}
              {total > 0 && result.query.mode !== "none" && (
                <div
                  className={cn(
                    "inline-flex items-center gap-1",
                    !showModeToggle && "ml-auto",
                  )}
                  role="group"
                  aria-label="Order"
                >
                  <button
                    type="button"
                    onClick={() => setSort("relevance")}
                    className={cn(
                      filterPill(sort === "relevance"),
                      "min-h-[44px] sm:min-h-[36px]",
                    )}
                    aria-pressed={sort === "relevance"}
                  >
                    Best match
                  </button>
                  <button
                    type="button"
                    onClick={() => setSort("date")}
                    className={cn(
                      filterPill(sort === "date"),
                      "min-h-[44px] sm:min-h-[36px]",
                    )}
                    aria-pressed={sort === "date"}
                  >
                    Newest
                  </button>
                </div>
              )}
            </div>
          )}

          {/* The notes. A card that is in the next answer too stays put,
              and only a new one fades in. */}
          {hits.length > 0 && (
            <div className="space-y-2">
              {hits.map((hit, i) => (
                <HitCard key={hit.id} hit={hit} index={i} onOpen={open} />
              ))}
            </div>
          )}

          {/* Pages */}
          {hits.length > 0 && total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-on-surface-variant">
              <span>
                Showing {first}–{last} of {total}
              </span>
              <div className="flex items-center gap-1">
                <IconButton
                  aria-label="Previous page"
                  tone="subtle"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </IconButton>
                <IconButton
                  aria-label="Next page"
                  tone="subtle"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                >
                  <ChevronRight className="w-4 h-4" />
                </IconButton>
              </div>
            </div>
          )}

          {/* Nothing. The words are stemmed and every word longer than a
              letter matches as a prefix, so "hire" already finds hiring:
              the way on is fewer words, or a wider period. */}
          {total === 0 && (
            <EmptyState
              icon={SearchX}
              title="No notes match"
              body={
                result.query.range
                  ? "Try a wider period, or fewer words"
                  : "Try fewer or other words"
              }
              // A chosen kind is the narrowest filter, and the one a
              // person forgets they set. One press widens it again.
              action={
                type
                  ? {
                      label: "Search all kinds",
                      onClick: () => update({ type: "" }),
                    }
                  : undefined
              }
              className="tile-enter"
            />
          )}
        </div>
      )}

      {/*
        Failure. `role="alert"` so it is announced when it appears; the status
        region says nothing for an error, so the failure is spoken once.
      */}
      {search.isError && (
        <div role="alert" className="tile-enter">
          <EmptyState
            icon={AlertTriangle}
            tone="error"
            title="Search failed"
            body={
              search.error instanceof Error
                ? search.error.message
                : "An unexpected error occurred"
            }
          />
        </div>
      )}
    </div>
  );
};
