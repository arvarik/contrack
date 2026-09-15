// =============================================================================
// Date phrases — "last month" in a question, as a range in the caller's zone
// =============================================================================
// "Who discussed hiring last month?" carries two things: a topic and a
// period. This module lifts the period out of the text so the topic can go
// to the index on its own, and turns it into an instant range the search can
// apply as a plain filter.
//
// Everything here is deterministic and local. There is no model in the loop
// and the phrases it understands are the ones listed below; anything else is
// left in the text as words to search for. A period is a calendar period in
// the caller's time zone, because "last month" to somebody in California is
// not the UTC month, and the difference is a whole evening of notes at each
// end.
// =============================================================================

/** An instant range. `from` is inclusive, `to` is exclusive, both ISO. */
export interface DateRange {
  from: string;
  to: string;
}

export interface DatePhraseMatch extends DateRange {
  /** The words that were read as the period, exactly as they appeared. */
  phrase: string;
}

export interface DatePhraseResult {
  /** The query with the period removed and whitespace tidied. */
  text: string;
  /** The period, or null when the query names none. */
  range: DatePhraseMatch | null;
}

export interface DatePhraseOptions {
  /** The moment "today" is measured from. Defaults to the wall clock. */
  now?: Date;
  /** An IANA zone. Defaults to UTC. Validate with `isValidTimeZone` first. */
  timeZone?: string;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_ABBREVIATIONS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
];
const MONTH_PATTERN = `(?:${[...MONTHS, ...MONTH_ABBREVIATIONS]
  .sort((a, b) => b.length - a.length)
  .join("|")})\\.?`;

const WRITTEN_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Whether Intl knows the zone. A bad name must be refused, not defaulted. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock reading of an instant in a zone. */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function zoneOffset(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Local midnight of a calendar day, as an instant.
 *
 * Two passes, because the offset can change between the guess and the
 * answer on a transition day. Month and day may run past their range and
 * roll over, which is what lets "the day after the last of the month" be
 * written as day + 1 rather than a calendar of its own.
 */
function startOfDay(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffset(new Date(guess), timeZone);
  const second = guess - zoneOffset(new Date(first), timeZone);
  return new Date(second);
}

function range(from: Date, to: Date): DateRange {
  return { from: from.toISOString(), to: to.toISOString() };
}

function monthIndex(name: string): number {
  const key = name.toLowerCase().replace(/\.$/, "");
  const full = MONTHS.indexOf(key);
  if (full !== -1) return full + 1;
  const short = MONTH_ABBREVIATIONS.indexOf(key);
  if (short === -1) return -1;
  return short >= MONTH_ABBREVIATIONS.indexOf("sept") ? short : short + 1;
}

function amount(word: string): number | null {
  const lower = word.toLowerCase();
  if (lower in WRITTEN_NUMBERS) return WRITTEN_NUMBERS[lower];
  const n = Number(lower);
  return Number.isInteger(n) && n > 0 && n <= 366 ? n : null;
}

type Resolver = (
  match: RegExpMatchArray,
  now: Date,
  timeZone: string,
) => DateRange | null;

interface Rule {
  pattern: RegExp;
  resolve: Resolver;
}

/** The unit-based periods share one resolver. */
function calendarPeriod(
  unit: string,
  which: "this" | "last",
  now: Date,
  timeZone: string,
): DateRange | null {
  const p = zonedParts(now, timeZone);
  switch (unit) {
    case "day":
      return which === "this"
        ? range(
            startOfDay(p.year, p.month, p.day, timeZone),
            startOfDay(p.year, p.month, p.day + 1, timeZone),
          )
        : range(
            startOfDay(p.year, p.month, p.day - 1, timeZone),
            startOfDay(p.year, p.month, p.day, timeZone),
          );
    case "week": {
      // Weeks begin on Monday.
      const sinceMonday = (p.weekday + 6) % 7;
      const monday = p.day - sinceMonday - (which === "last" ? 7 : 0);
      return range(
        startOfDay(p.year, p.month, monday, timeZone),
        startOfDay(p.year, p.month, monday + 7, timeZone),
      );
    }
    case "month": {
      const month = which === "this" ? p.month : p.month - 1;
      return range(
        startOfDay(p.year, month, 1, timeZone),
        startOfDay(p.year, month + 1, 1, timeZone),
      );
    }
    case "quarter": {
      const start = p.month - ((p.month - 1) % 3) - (which === "last" ? 3 : 0);
      return range(
        startOfDay(p.year, start, 1, timeZone),
        startOfDay(p.year, start + 3, 1, timeZone),
      );
    }
    case "year": {
      const year = which === "this" ? p.year : p.year - 1;
      return range(
        startOfDay(year, 1, 1, timeZone),
        startOfDay(year + 1, 1, 1, timeZone),
      );
    }
  }
  return null;
}

/** A rolling window that ends now: "the last 30 days", "past two weeks". */
function rollingPeriod(
  count: number,
  unit: string,
  now: Date,
  timeZone: string,
): DateRange | null {
  const p = zonedParts(now, timeZone);
  let from: Date;
  switch (unit) {
    case "day":
      from = new Date(now.getTime() - count * 86_400_000);
      break;
    case "week":
      from = new Date(now.getTime() - count * 7 * 86_400_000);
      break;
    case "month":
      from = startOfDay(p.year, p.month - count, p.day, timeZone);
      break;
    case "year":
      from = startOfDay(p.year - count, p.month, p.day, timeZone);
      break;
    default:
      return null;
  }
  return range(from, now);
}

/** A named month, in the most recent year where it has begun. */
function namedMonth(
  name: string,
  yearText: string | undefined,
  now: Date,
  timeZone: string,
): DateRange | null {
  const month = monthIndex(name);
  if (month === -1) return null;
  const p = zonedParts(now, timeZone);
  const year = yearText
    ? Number(yearText)
    : month <= p.month
      ? p.year
      : p.year - 1;
  return range(
    startOfDay(year, month, 1, timeZone),
    startOfDay(year, month + 1, 1, timeZone),
  );
}

function namedYear(yearText: string, timeZone: string): DateRange {
  const year = Number(yearText);
  return range(
    startOfDay(year, 1, 1, timeZone),
    startOfDay(year + 1, 1, 1, timeZone),
  );
}

function isoDay(text: string, timeZone: string): DateRange | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const from = startOfDay(year, month, day, timeZone);
  if (zonedParts(from, timeZone).month !== month) return null;
  return range(from, startOfDay(year, month, day + 1, timeZone));
}

/**
 * A period that "since", "before" and "after" can anchor on: a month, a
 * year, an ISO day, or one of the relative words.
 */
function anchorPeriod(
  text: string,
  now: Date,
  timeZone: string,
): DateRange | null {
  const t = text.trim().toLowerCase();
  const relative = t.match(
    /^(?:(this|last|past|previous)\s+(week|month|quarter|year)|(today|yesterday))$/,
  );
  if (relative) {
    if (relative[3])
      return calendarPeriod(
        "day",
        relative[3] === "today" ? "this" : "last",
        now,
        timeZone,
      );
    return calendarPeriod(
      relative[2],
      relative[1] === "this" ? "this" : "last",
      now,
      timeZone,
    );
  }
  const month = t.match(new RegExp(`^(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?$`));
  if (month) return namedMonth(month[1], month[2], now, timeZone);
  if (/^20\d{2}$/.test(t)) return namedYear(t, timeZone);
  return isoDay(t, timeZone);
}

const LEAD = "(?:(?:in|during|from|over|within|for|on|of)\\s+)?(?:the\\s+)?";
const UNIT = "(day|week|month|quarter|year)s?";
// The ISO day comes before the bare year: "2026-08-01" must not read as "2026".
const ANCHOR = `(?:(?:this|last|past|previous)\\s+(?:week|month|quarter|year)|today|yesterday|${MONTH_PATTERN}(?:\\s+20\\d{2})?|\\d{4}-\\d{2}-\\d{2}|20\\d{2})`;

/**
 * The phrases, most specific first. Each pattern is anchored on word
 * boundaries so "in 2025" never matches inside "win 20250".
 */
const RULES: Rule[] = [
  {
    // between March and May, between 2026-01-01 and 2026-02-01
    pattern: new RegExp(
      `\\b(?:between|from)\\s+(${ANCHOR})\\s+(?:and|to|until|through)\\s+(${ANCHOR})\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const a = anchorPeriod(m[1], now, tz);
      const b = anchorPeriod(m[2], now, tz);
      if (!a || !b) return null;
      const from = a.from < b.from ? a.from : b.from;
      const to = a.to > b.to ? a.to : b.to;
      return { from, to };
    },
  },
  {
    // since last month, since March, since 2025, since 2026-08-01
    pattern: new RegExp(`\\b(?:since|after|from)\\s+(${ANCHOR})\\b`, "i"),
    resolve: (m, now, tz) => {
      const anchor = anchorPeriod(m[1], now, tz);
      if (!anchor) return null;
      const since = /^since/i.test(m[0]) || /^from/i.test(m[0]);
      return {
        from: since ? anchor.from : anchor.to,
        to: now.toISOString(),
      };
    },
  },
  {
    // before March, before 2025, until last week
    pattern: new RegExp(`\\b(?:before|until|up to)\\s+(${ANCHOR})\\b`, "i"),
    resolve: (m, now, tz) => {
      const anchor = anchorPeriod(m[1], now, tz);
      if (!anchor) return null;
      return { from: new Date(0).toISOString(), to: anchor.from };
    },
  },
  {
    // in the last 30 days, past two weeks, over the last year
    pattern: new RegExp(
      `\\b${LEAD}(?:last|past|previous)\\s+(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+${UNIT}\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const count = amount(m[1]);
      return count == null
        ? null
        : rollingPeriod(count, m[2].toLowerCase(), now, tz);
    },
  },
  {
    // this week, last month, past quarter, previous year
    pattern: new RegExp(
      `\\b${LEAD}(this|last|past|previous)\\s+(week|month|quarter|year)\\b`,
      "i",
    ),
    resolve: (m, now, tz) =>
      calendarPeriod(
        m[2].toLowerCase(),
        m[1].toLowerCase() === "this" ? "this" : "last",
        now,
        tz,
      ),
  },
  {
    pattern: new RegExp(`\\b${LEAD}(today|yesterday)\\b`, "i"),
    resolve: (m, now, tz) =>
      calendarPeriod(
        "day",
        m[1].toLowerCase() === "today" ? "this" : "last",
        now,
        tz,
      ),
  },
  {
    // in March, March 2026, in Sept 2025
    pattern: new RegExp(
      `\\b${LEAD}(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`,
      "i",
    ),
    resolve: (m, now, tz) => namedMonth(m[1], m[2], now, tz),
  },
  {
    // on 2026-08-12. Before the bare year, which would otherwise take "2026".
    pattern: new RegExp(`\\b${LEAD}(\\d{4}-\\d{2}-\\d{2})\\b`, "i"),
    resolve: (m, _now, tz) => isoDay(m[1], tz),
  },
  {
    // in 2025
    pattern: new RegExp(`\\b${LEAD}(20\\d{2})\\b`, "i"),
    resolve: (m, _now, tz) => namedYear(m[1], tz),
  },
];

/**
 * Lift the first date phrase out of a query.
 *
 * "May" on its own is left alone: it is a month, and it is also the most
 * common modal verb in English, so it only counts as a month with a year
 * after it or a preposition before it.
 */
export function extractDatePhrase(
  query: string,
  options: DatePhraseOptions = {},
): DatePhraseResult {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "UTC";
  for (const rule of RULES) {
    const match = query.match(rule.pattern);
    if (!match || match.index === undefined) continue;
    if (/^may$/i.test(match[0].trim())) continue;
    const resolved = rule.resolve(match, now, timeZone);
    if (!resolved) continue;
    const text = (
      query.slice(0, match.index) +
      " " +
      query.slice(match.index + match[0].length)
    )
      .replace(/\s+/g, " ")
      .trim();
    return { text, range: { ...resolved, phrase: match[0].trim() } };
  }
  return { text: query.trim(), range: null };
}

/**
 * The instant bounds of a filter value.
 *
 * A calendar date names a whole day in the caller's zone, so `from` is that
 * day's midnight and `to` is the midnight after. An instant is taken as it
 * is: `from` inclusive, `to` exclusive.
 */
export function boundFromFilter(
  value: string,
  edge: "from" | "to",
  timeZone: string,
): string | null {
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const period = isoDay(value, timeZone);
    if (!period) return null;
    return edge === "from" ? period.from : period.to;
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
