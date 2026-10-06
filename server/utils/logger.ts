// The server log: one line per event on standard output, `[time] [LEVEL] [area]
// message`, then the details as JSON when there are any.
//   - LOG_LEVEL sets the lowest level written: error, warn, info or debug.
//     Unset means info. Another value logs one warning and runs at info.
//   - Colors only on a terminal. `docker logs` and a file get plain text.
//   - An Error in the details is written as its name, message and stack
//     (JSON.stringify would write {}).
//
// A line names records by id and gives counts and times. It never carries a
// person's name, an email address, a phone number, an address, note or title
// text, a file name somebody chose, a search or an Ask question, a pasted URL
// or model output: the operator keeps this log as long as they like, and the
// people in it never agreed to that.

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[90m",
  INFO: "\x1b[36m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
};
const RESET = "\x1b[0m";

const RANK: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LEVEL_NAMES = new Map<string, LogLevel>([
  ["error", "ERROR"],
  ["warn", "WARN"],
  ["info", "INFO"],
  ["debug", "DEBUG"],
]);

/** The LOG_LEVEL value last read, and the lowest rank it lets through. */
let current: { raw: string | undefined; min: number } | undefined;

/**
 * The lowest rank written. LOG_LEVEL is read on each call and parsed again only
 * when it changes, so a bad value warns once. It is read at the first line, not
 * at import, so a script that loads `.env` after importing this module still
 * gets its level.
 */
function minRank(): number {
  const raw = process.env.LOG_LEVEL;
  if (current && current.raw === raw) return current.min;
  const name = raw?.trim().toLowerCase() ?? "";
  const level = LEVEL_NAMES.get(name);
  current = { raw, min: RANK[level ?? "INFO"] };
  if (name && !level) {
    log._fmt(
      "WARN",
      "Config",
      `LOG_LEVEL must be error, warn, info or debug, and "${raw}" is not. Logging at info.`,
    );
  }
  return current.min;
}

/** JSON.stringify replacer: an Error becomes its name, message and stack. */
function errorFields(_key: string, value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    ...(value.cause instanceof Error && { cause: value.cause }),
  };
}

function detailsText(meta: Record<string, unknown>): string {
  try {
    return ` ${JSON.stringify(meta, errorFields)}`;
  } catch {
    // A cycle or a BigInt. The line still says what happened.
    return " [details could not be written]";
  }
}

function write(
  level: LogLevel,
  tag: string,
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if (RANK[level] < minRank()) return;
  log._fmt(level, tag, msg, meta);
}

/**
 * The server log. Each method takes the area (`"Connectors"`), one line of
 * text, and optional details that are written as JSON.
 *
 * @example
 * ```ts
 * log.error("Connectors", `Sync failed for connector ${id}`, { error: err });
 * ```
 */
export const log = {
  /** Writes one line, whatever the level. Scripts replace it to go quiet. */
  _fmt(
    level: LogLevel,
    tag: string,
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString();
    const color = process.stdout.isTTY ? LOG_COLORS[level] : "";
    const reset = color ? RESET : "";
    const metaStr = meta ? detailsText(meta) : "";
    console.log(`${color}[${ts}] [${level}] [${tag}]${reset} ${msg}${metaStr}`);
  },
  debug: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    write("DEBUG", tag, msg, meta),
  info: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    write("INFO", tag, msg, meta),
  warn: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    write("WARN", tag, msg, meta),
  error: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    write("ERROR", tag, msg, meta),
};
