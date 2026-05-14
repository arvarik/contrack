type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[90m",
  INFO: "\x1b[36m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
};
const RESET = "\x1b[0m";

export const log = {
  _fmt(
    level: LogLevel,
    tag: string,
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString();
    const color = LOG_COLORS[level];
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`${color}[${ts}] [${level}] [${tag}]${RESET} ${msg}${metaStr}`);
  },
  debug: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    log._fmt("DEBUG", tag, msg, meta),
  info: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    log._fmt("INFO", tag, msg, meta),
  warn: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    log._fmt("WARN", tag, msg, meta),
  error: (tag: string, msg: string, meta?: Record<string, unknown>) =>
    log._fmt("ERROR", tag, msg, meta),
};
