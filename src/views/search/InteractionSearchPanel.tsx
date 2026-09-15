/**
 * InteractionSearchPanel — the Notes mode of the search page.
 *
 * "Who discussed hiring last month?" → the notes that say so, each with the
 * person it is about, the date, and the passage that matched. Everything is
 * local: the server runs FTS5 over the note index and no model is called, so
 * the same question over the same notes gives the same page every time.
 *
 * The state lives in the URL (`q`, `from`, `to`, `type`), so Back returns to
 * the same search and a link to it can be shared. The input is the one thing
 * kept locally, debounced into `q`, so typing does not rewrite the address
 * bar on every keystroke.
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
  Search,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useInteractionSearch } from "../../api/search";
import { useDebounce } from "../../hooks/useDebounce";
import { isTypingTarget } from "../../lib/keyboard";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { formatDay, formatRelative, parseServerTime } from "../../lib/datetime";
import { CARD, filterPill } from "../../lib/styles";
import { cn } from "../../lib/utils";
import type { HighlightRange, InteractionSearchHit } from "../../types";

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  "Who discussed hiring last month?",
  "fundraising this year",
  "coffee in the last 30 days",
  "Berlin office since March",
];

const TYPES: { value: string; label: string }[] = [
  { value: "", label: "All kinds" },
  { value: "note", label: "Notes" },
  { value: "call", label: "Calls" },
  { value: "meeting", label: "Meetings" },
  { value: "email", label: "Emails" },
  { value: "message", label: "Messages" },
];

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  call: Phone,
  meeting: Handshake,
  email: Mail,
  message: MessageSquare,
  sms: MessageSquare,
};

const PAGE_SIZE = 20;

type Period = "any" | "7d" | "30d" | "month" | "year" | "custom";

const PERIODS: { value: Exclude<Period, "custom">; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "Last month" },
  { value: "year", label: "This year" },
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
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  // The end is exclusive, so the last day inside the range is a moment before.
  const lastDay = end ? new Date(end.getTime() - 1) : null;
  if (start && lastDay) return `${day(start)} – ${day(lastDay)}`;
  if (start) return `since ${day(start)}`;
  if (lastDay) return `until ${day(lastDay)}`;
  return "";
}

// ─── Highlighted text ─────────────────────────────────────────────────────────

/** Text with the matched terms marked. Ranges come from the server, sorted. */
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
    parts.push(
      <mark
        key={`m${i}`}
        className="bg-primary/15 text-on-surface rounded-sm px-0.5 font-semibold"
      >
        {text.slice(start, end)}
      </mark>,
    );
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
          CARD,
          "w-full text-left flex items-start gap-4 group",
          "hover:shadow-md hover:ring-2 hover:ring-primary/20 transition-[box-shadow] duration-200 cursor-pointer",
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
            className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mt-0.5"
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
  const [offset, setOffset] = useState(0);
  /**
   * Whether the reader asked for the date fields. Dates that happen to equal
   * a preset are shown as that preset until Custom is chosen, and Custom
   * stays open until a preset is chosen, so the fields do not vanish under
   * a reader who has just typed the last day of last month into them.
   */
  const [customOpen, setCustomOpen] = useState(false);
  const debounced = useDebounce(text.trim(), 250);

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

  // The debounced input becomes the question in the URL.
  useEffect(() => {
    if (debounced !== q) update({ q: debounced });
  }, [debounced, q, update]);

  // A new question or filter starts from the first page.
  useEffect(() => {
    setOffset(0);
  }, [q, from, to, type, mode, sort]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const hasSearch = Boolean(q || from || to || type);
  const showModeToggle = (result?.query.tokens.length ?? 0) >= 2;

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

  return (
    <div className="space-y-6">
      {/* Question */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-surface-container-lowest rounded-2xl shadow-sm px-4 sm:px-5 py-3.5 sm:py-4 focus-within:ring-2 focus-within:ring-primary/30 focus-within:shadow-md transition-[box-shadow] duration-200">
        {search.isFetching ? (
          <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
        ) : (
          <Search className="w-5 h-5 text-primary shrink-0" />
        )}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              clear();
            }
          }}
          placeholder="Search your notes…"
          aria-label="Search your notes"
          className="flex-1 min-w-0 bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-on-surface-variant text-base sm:text-lg"
        />
        <button
          type="button"
          onClick={clear}
          tabIndex={hasSearch ? 0 : -1}
          aria-hidden={!hasSearch}
          className={cn(
            "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-opacity duration-150 shrink-0",
            !hasSearch && "opacity-0 pointer-events-none",
          )}
          aria-label="Clear search"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Period and kind */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays
          className="w-4 h-4 text-on-surface-variant shrink-0"
          aria-hidden
        />
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => choosePeriod(p.value)}
            className={cn(filterPill(period === p.value), "min-h-[36px]")}
            aria-pressed={period === p.value}
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
        <label className="ml-auto flex items-center gap-2 text-xs font-bold text-on-surface-variant">
          <span className="sr-only sm:not-sr-only">Kind</span>
          <select
            value={type}
            onChange={(e) => update({ type: e.target.value })}
            aria-label="Kind of note"
            className="bg-surface-container-low rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:ring-2 focus:ring-primary/40 focus:outline-none min-h-[36px]"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
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
              className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary/40 focus:outline-none min-h-[36px]"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-on-surface-variant">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => update({ to: e.target.value })}
              className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary/40 focus:outline-none min-h-[36px]"
            />
          </label>
        </div>
      )}

      {/* Before the first search */}
      {!hasSearch && (
        <div className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Try asking...
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EXAMPLE_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => {
                  setText(question);
                  update({ q: question });
                }}
                className="tile-enter text-left px-4 py-3 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md hover:bg-primary/5 text-sm text-on-surface-variant hover:text-primary transition-[background-color,box-shadow,color] duration-200 group"
              >
                <span className="text-primary mr-1.5 font-bold">?</span>
                {question}
              </button>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant">
            Dates in a question are understood: last week, last month, this
            year, the last 30 days, since March, in 2025, or between two months.
            Words are matched by their stem, so hire finds hiring.
          </p>
        </div>
      )}

      {/* What the server understood */}
      {hasSearch && result && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="font-bold uppercase tracking-widest text-primary">
            {total} note{total === 1 ? "" : "s"}
          </span>
          {result.query.range && (
            <span className="inline-flex items-center gap-1.5 bg-surface-container-high text-on-surface px-2.5 py-1 rounded-full">
              <CalendarDays className="w-3 h-3 text-primary" aria-hidden />
              {result.query.phrase && result.query.range.source === "phrase"
                ? `“${result.query.phrase}” → `
                : ""}
              {describeRange(result.query.range.from, result.query.range.to)}
            </span>
          )}
          {result.query.mode === "any" && showModeToggle && mode === "auto" && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
              No note has every word, showing notes with any of them
            </span>
          )}
          {showModeToggle && (
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
                  "min-h-[36px]",
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
                  "min-h-[36px]",
                )}
                aria-pressed={result.query.mode === "any"}
              >
                Any word
              </button>
            </div>
          )}
          {result.query.mode !== "none" && (
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
                className={cn(filterPill(sort === "relevance"), "min-h-[36px]")}
                aria-pressed={sort === "relevance"}
              >
                Best match
              </button>
              <button
                type="button"
                onClick={() => setSort("date")}
                className={cn(filterPill(sort === "date"), "min-h-[36px]")}
                aria-pressed={sort === "date"}
              >
                Newest
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {hits.length > 0 && (
        <div
          key={`${q}|${from}|${to}|${type}|${offset}`}
          className={cn(
            "fade-enter space-y-2 transition-opacity",
            search.isPlaceholderData && "opacity-70",
          )}
        >
          {hits.map((hit, i) => (
            <HitCard key={hit.id} hit={hit} index={i} onOpen={open} />
          ))}
        </div>
      )}

      {/* Pages */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            Showing {first}–{last} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Nothing */}
      {hasSearch && search.isSuccess && total === 0 && (
        <div className="tile-enter flex flex-col items-center justify-center py-12 text-center space-y-3">
          <div className="p-4 bg-surface-container-low rounded-2xl">
            <Search className="w-10 h-10 text-on-surface-variant/30" />
          </div>
          <p className="font-bold text-on-surface">No notes match</p>
          <p className="text-sm text-on-surface-variant max-w-md">
            {result?.query.range
              ? "Try a wider period, or fewer words."
              : "Try fewer words, or a stem such as hire for hiring."}
          </p>
        </div>
      )}

      {/* Failure */}
      {search.isError && (
        <div className="tile-enter flex flex-col items-center justify-center py-12 text-center">
          <div className="p-4 bg-rose-500/10 rounded-2xl mb-3">
            <AlertTriangle className="w-10 h-10 text-error" />
          </div>
          <p className="font-bold text-on-surface mb-1">Search failed</p>
          <p className="text-sm text-on-surface-variant">
            {search.error instanceof Error
              ? search.error.message
              : "An unexpected error occurred."}
          </p>
        </div>
      )}
    </div>
  );
};
