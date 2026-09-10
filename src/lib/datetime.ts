/**
 * Reading the two timestamp formats this database writes.
 *
 * SQLite's `CURRENT_TIMESTAMP` produces `2026-09-10 05:33:50` — UTC, with a
 * space and no zone marker. Everything written from JavaScript produces
 * `2026-09-10T05:33:50.000Z`. Both land in the same columns, and `new Date()`
 * reads the first as *local* time, which puts every such value hours out.
 *
 * That mismatch has already caused real bugs on the server side, where SQLite
 * compares the two as raw text. On the client it is quieter and just as
 * wrong: a session last used a minute ago reads as seven hours ago in
 * California, or an hour in the future in Berlin.
 *
 * @module lib/datetime
 */

/**
 * Parse a timestamp from the API, whichever of the two forms it is in.
 *
 * Returns null rather than an Invalid Date, so a caller has to decide what to
 * show instead of rendering the string "Invalid Date" at somebody.
 */
export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  // A space separator and no zone means SQLite wrote it, and SQLite writes
  // UTC. Naming the zone is what stops the browser assuming local.
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An absolute date and time, in the reader's own locale and zone. */
export function formatWhen(
  value: string | null | undefined,
  fallback = "Unknown",
): string {
  const date = parseServerTime(value);
  if (!date) return fallback;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A date alone, for columns where the time of day is noise. */
export function formatDay(
  value: string | null | undefined,
  fallback = "Unknown",
): string {
  const date = parseServerTime(value);
  if (!date) return fallback;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * "3 days ago", "in 2 hours", "just now".
 *
 * Used where the exact instant matters less than the distance from now: when
 * an account last signed in, when a token was last used. The absolute value
 * goes in the `title` at the call site, for the reader who wants it.
 */
export function formatRelative(
  value: string | null | undefined,
  fallback = "Never",
): string {
  const date = parseServerTime(value);
  if (!date) return fallback;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 45) return "just now";

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  for (const [unit, size] of units) {
    if (magnitude >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(Math.round(seconds), "second");
}

/** A byte count a person can read. Used by the backups list. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
