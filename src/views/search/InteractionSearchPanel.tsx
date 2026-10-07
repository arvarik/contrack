/**
 * The Notes mode of the search page. The server runs FTS5 over the note
 * index and calls no model, so the same question gives the same page.
 *
 * The state lives in the URL (`q`, `from`, `to`, `type`), so Back returns to
 * the same search. Only the input is local, and it reaches `q` on search.
 * The filters apply the moment they change.
 *
 * While an answer loads, the last one stays on screen and the next replaces
 * it in place, so a card in both answers stays put. Past 150 ms the old
 * answer dims and the glyph spins (`useLoadingShown`). Only a first search
 * shows the "Searching…" line and the shimmer, for at least 400 ms so they
 * never blink.
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
  AlertCircle,
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
import { cn, errorText } from "../../lib/utils";
import { LiveStatus } from "../../components/ui/LiveStatus";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Select, type SelectOption } from "../../components/ui/Select";
import type { InteractionSearchHit } from "../../types";
import { Highlighted } from "../../components/ui/Highlighted";
import { AskSearchBox } from "./AskSearchBox";
import { ShimmerCard } from "./SearchResultCards";

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  call: Phone,
  meeting: Handshake,
  email: Mail,
  message: MessageSquare,
  sms: MessageSquare,
};

/** The kinds of note. The chip shows the chosen kind with its glyph. */
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

/** The periods as one chip, for a phone, where six chips take three rows. */
const PERIOD_OPTIONS: SelectOption<Period>[] = [
  ...PERIODS,
  { value: "custom", label: "Custom" },
];

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
  // formatDay's medium date, called directly because these bounds are Dates.
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, { dateStyle: "medium" });
  const lastDay = end ? new Date(end.getTime() - 1) : null;
  if (start && lastDay) return `${day(start)} – ${day(lastDay)}`;
  if (start) return `since ${day(start)}`;
  if (lastDay) return `until ${day(lastDay)}`;
  return "";
}

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
  // A new question or filter starts from the first page. This is derived in
  // render, so the query never runs once with the old offset, as it would
  // with a reset in an effect.
  const searchKey = [q, from, to, type, mode, sort].join("\u0000");
  const [page, setPage] = useState({ key: searchKey, offset: 0 });
  const offset = page.key === searchKey ? page.offset : 0;
  const setOffset = (next: number) => setPage({ key: searchKey, offset: next });
  // Custom stays open until a preset is chosen, so the date fields do not
  // vanish when typed dates happen to equal a preset.
  const [customOpen, setCustomOpen] = useState(false);

  /** Writes fields to the URL and drops the ones set to "". */
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

  // The box follows a question from a history entry or from Back.
  const prevQRef = useRef(q);
  useEffect(() => {
    if (q !== prevQRef.current) {
      prevQRef.current = q;
      setText(q);
    }
  }, [q]);

  // Focus the box on arrival, except after an arrow key on the People / Notes
  // radiogroup: the next arrow press must move between its options, not type.
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
  // A date phrase ("coffee last month") sets the range and shows its own
  // chip, so no period shows pressed then.
  const phraseSetsRange =
    period === "any" && result?.query.range?.source === "phrase";
  const shownPeriod: Period | null = phraseSetsRange ? null : period;
  const hasSearch = Boolean(q || from || to || type);
  const showModeToggle = (result?.query.tokens.length ?? 0) >= 2;

  // `keepPreviousData` keeps the old answer on screen while this one loads.
  // With nothing on screen yet, the shimmer shows instead, once per wait.
  const busy = useLoadingShown(hasSearch && search.isFetching);
  const stale = Boolean(result) && search.isPlaceholderData;
  const [shimmer, setShimmer] = useState(false);
  if (busy && !result && !shimmer) setShimmer(true);
  if (!busy && shimmer) setShimmer(false);
  const dimmed = busy && stale;

  const recordSearch = useRecordSearch();
  const lastRecordedNotesQueryRef = useRef<string | null>(null);

  // Record each question once, with its own answer, not the placeholder.
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

  // The words go to the URL, which the query reads. The same words refetch.
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

  // The one sentence a screen reader hears about this search.
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
        The same box as People's, so switching modes moves nothing. A spinner,
        not the thinking bird, shows while a search runs: no model reads notes.
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
          The kind comes first, then the period. On a phone the periods fold
          into one chip, so the two filters share one row.
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

      {/* A first search: the shimmer and the answer swap in one commit. */}
      {shimmer && (
        <div className="fade-enter space-y-3">
          <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-[0.08em] mb-4">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Searching…
          </div>
          <ShimmerCard delay={0} />
          <ShimmerCard delay={0.08} />
          <ShimmerCard delay={0.16} />
        </div>
      )}

      {showAnswer && result && (
        <div
          aria-busy={dimmed || undefined}
          className={cn("space-y-6 transition-opacity", dimmed && "opacity-60")}
        >
          {/* With no notes found, only the range read and the way back from
              "All words" stay. */}
          {(total > 0 ||
            result.query.range ||
            (showModeToggle && mode === "all")) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              {total > 0 && (
                <div className="flex items-center gap-2">
                  {/* Muted ink, as on People: blue would read as a link. */}
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

          {hits.length > 0 && (
            <div className="space-y-2">
              {hits.map((hit, i) => (
                <HitCard key={hit.id} hit={hit} index={i} onOpen={open} />
              ))}
            </div>
          )}

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

          {/* Words are stemmed and match as prefixes, so the hint is fewer
              words or a wider period, not other word forms. */}
          {total === 0 && (
            <EmptyState
              icon={SearchX}
              title="No notes match"
              body={
                result.query.range
                  ? "Try a wider period, or fewer words"
                  : "Try fewer or other words"
              }
              // A chosen kind is the filter people forget they set.
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

      {/* The status region is silent on an error, so the alert speaks once. */}
      {search.isError && (
        <div role="alert" className="tile-enter">
          <EmptyState
            icon={AlertCircle}
            tone="error"
            title="Could not search"
            body={errorText(search.error)}
          />
        </div>
      )}
    </div>
  );
};
