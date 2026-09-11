/**
 * The one-time move of preferences out of localStorage.
 *
 * Five keys were written by four hooks and a settings page. They are read once,
 * handed to the server, and removed. Removing them is the point, not tidiness:
 * `localStorage` is keyed by origin, so the values left behind are readable by
 * whoever signs in next in the same browser.
 *
 * A key the account has already chosen on another device is NOT migrated. The
 * server's answer is the newer one by definition — it came from a device
 * somebody used deliberately — and a stale local value overwriting it would
 * make the migration feel like a bug ("my phone reset my laptop").
 *
 * Everything here is defensive. These values were written by older versions
 * and by hand-edited browser storage, so a value that does not parse is
 * dropped rather than sent.
 *
 * @module lib/localPreferenceMigration
 */
import type { Preferences, SearchHistoryEntry } from "../api/preferences";

/** The old key names, kept here so the removal and the read cannot disagree. */
export const LEGACY_KEYS = {
  listDensity: "contrack_list_density",
  recentLimit: "contrack_recent_limit",
  dedupePreset: "contrack_dedupe_settings",
  tempUnit: "contrack_temp_unit",
  searchHistory: "contrack:search:history",
} as const;

/** Search history never grows past this, on the server or here. */
const MAX_SEARCH_HISTORY = 20;
const MAX_QUERY_LENGTH = 200;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseDensity(raw: string | null): Preferences["listDensity"] | null {
  return raw === "compact" || raw === "comfortable" ? raw : null;
}

function parseRecentLimit(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), 0), 10);
}

function parseTempUnit(raw: string | null): Preferences["tempUnit"] | null {
  return raw === "celsius" || raw === "fahrenheit" ? raw : null;
}

/**
 * The dedupe settings blob, in either of the two shapes it ever had.
 *
 * The newer one holds a preset name. The older one held a raw threshold from
 * a slider that no longer exists, and the hook that read it mapped the number
 * to the nearest preset — so that mapping happens here too, once, on the way
 * out. Dropping it would silently reset anybody who has not opened the dedupe
 * settings since the slider was removed.
 */
function parseDedupePreset(
  raw: string | null,
): Preferences["dedupePreset"] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      preset?: unknown;
      autoMergeThreshold?: unknown;
    };
    if (
      parsed.preset === "aggressive" ||
      parsed.preset === "default" ||
      parsed.preset === "conservative"
    ) {
      return parsed.preset;
    }
    if (typeof parsed.autoMergeThreshold === "number") {
      if (parsed.autoMergeThreshold <= 0.9) return "aggressive";
      if (parsed.autoMergeThreshold >= 0.95) return "conservative";
      return "default";
    }
  } catch {
    // Not JSON.
  }
  return null;
}

function parseSearchHistory(raw: string | null): SearchHistoryEntry[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const entries = parsed
      .filter((entry): entry is SearchHistoryEntry => {
        if (typeof entry !== "object" || entry === null) return false;
        const e = entry as Record<string, unknown>;
        return (
          typeof e.query === "string" &&
          e.query.trim().length > 0 &&
          (e.mode === "normal" || e.mode === "ai" || e.mode === "action") &&
          typeof e.timestamp === "number" &&
          Number.isFinite(e.timestamp) &&
          e.timestamp >= 0
        );
      })
      .map((entry) => ({
        query: entry.query.trim().slice(0, MAX_QUERY_LENGTH),
        mode: entry.mode,
        timestamp: Math.floor(entry.timestamp),
      }))
      .slice(0, MAX_SEARCH_HISTORY);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Read whatever this browser still holds, then forget it.
 *
 * @param stored keys the account has already chosen elsewhere. These are read
 *   past — the local value is dropped, not sent.
 * @returns the preferences worth sending. Empty when there is nothing to move.
 */
export function takeLocalPreferences(
  stored: readonly (keyof Preferences)[],
): Partial<Preferences> {
  const already = new Set(stored);
  const patch: Partial<Preferences> = {};

  const density = parseDensity(read(LEGACY_KEYS.listDensity));
  if (density && !already.has("listDensity")) patch.listDensity = density;

  const limit = parseRecentLimit(read(LEGACY_KEYS.recentLimit));
  if (limit !== null && !already.has("recentLimit")) patch.recentLimit = limit;

  const preset = parseDedupePreset(read(LEGACY_KEYS.dedupePreset));
  if (preset && !already.has("dedupePreset")) patch.dedupePreset = preset;

  const unit = parseTempUnit(read(LEGACY_KEYS.tempUnit));
  if (unit && !already.has("tempUnit")) patch.tempUnit = unit;

  const history = parseSearchHistory(read(LEGACY_KEYS.searchHistory));
  if (history && !already.has("searchHistory")) patch.searchHistory = history;

  // Removed whether or not anything was migrated. A key that was skipped
  // because the account had already chosen is exactly the key that must not be
  // left lying in a shared browser.
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage is unavailable; there was nothing to read either.
    }
  }

  return patch;
}
