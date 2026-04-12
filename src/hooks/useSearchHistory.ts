/**
 * useSearchHistory — Persistent search history with terminal-style ↑/↓ recall.
 *
 * Design decisions:
 * - localStorage (not sessionStorage): history is more valuable across sessions
 *   ("that query I ran yesterday"). Recently-viewed contacts use sessionStorage
 *   because recency is inherently transient — history is not.
 * - Case-insensitive deduplication: "VCs in SF" and "vcs in sf" are the same query.
 * - Max 20 stored, max 5 displayed in zero-state. The extra headroom prevents
 *   the display list feeling stale after a few evictions.
 * - Terminal-style ↑/↓: historyIndex tracks position in the history stack.
 *   -1 = not navigating. 0 = most recent entry. navigateHistory returns the
 *   query string to fill into the input, or null if at bounds.
 *
 * @module src/hooks/useSearchHistory
 */
import { useState, useCallback, useRef } from "react";

/** Duration in ms within which reopening the palette restores the last query */
const REPOPULATE_WINDOW_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchHistoryEntry {
  /** The raw search text (without mode prefix for display) */
  query: string;
  /** Which mode was active when this search occurred */
  mode: "normal" | "ai" | "action";
  /** Epoch ms when the search was recorded */
  timestamp: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "contrack:search:history";
const MAX_STORED = 20;
const MAX_DISPLAY = 5;

// ─── Storage helpers ─────────────────────────────────────────────────────────

const readHistory = (): SearchHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate shape — filter out corrupted entries
    return parsed.filter(
      (e: unknown): e is SearchHistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as any).query === "string" &&
        typeof (e as any).mode === "string" &&
        typeof (e as any).timestamp === "number",
    );
  } catch {
    return [];
  }
};

const writeHistory = (entries: SearchHistoryEntry[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage quota exceeded — fail silently, history is non-critical
  }
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export const useSearchHistory = () => {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>(readHistory);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Stash the user's typed text before they started ↑/↓ so we can restore it on ↓ past 0
  const stashedInputRef = useRef<string>("");
  // Track last meaningful query for 30s re-populate on modal reopen
  const lastQueryRef = useRef<{ query: string; mode: string; timestamp: number } | null>(null);

  /**
   * Record a successful search. Deduplicates case-insensitively and caps at MAX_STORED.
   * Only call this after confirming the search returned meaningful results.
   */
  const addEntry = useCallback(
    (query: string, mode: "normal" | "ai" | "action") => {
      const trimmed = query.trim();
      if (trimmed.length < 2) return; // Don't record trivially short queries

      // Stamp the last-query ref for 30s re-populate
      lastQueryRef.current = { query: trimmed, mode, timestamp: Date.now() };

      setEntries((prev) => {
        // Remove existing entry with same query (case-insensitive)
        const deduped = prev.filter(
          (e) => e.query.toLowerCase() !== trimmed.toLowerCase(),
        );
        const updated: SearchHistoryEntry[] = [
          { query: trimmed, mode, timestamp: Date.now() },
          ...deduped,
        ].slice(0, MAX_STORED);
        writeHistory(updated);
        return updated;
      });
    },
    [],
  );

  /**
   * Clear all search history.
   */
  const clearHistory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEntries([]);
    setHistoryIndex(-1);
  }, []);

  /**
   * Terminal-style ↑/↓ navigation through history.
   *
   * @param direction - 'up' to go back in history, 'down' to go forward
   * @param currentInput - the current search input value (stashed on first ↑)
   * @returns the query string to fill into the input, or null if at bounds
   */
  const navigateHistory = useCallback(
    (direction: "up" | "down", currentInput: string): string | null => {
      const currentEntries = readHistory(); // Read fresh to avoid stale closure
      if (currentEntries.length === 0) return null;

      if (direction === "up") {
        const nextIndex = historyIndex + 1;
        if (nextIndex >= currentEntries.length) return null; // At oldest entry
        // Stash the user's input on first ↑ press
        if (historyIndex === -1) {
          stashedInputRef.current = currentInput;
        }
        setHistoryIndex(nextIndex);
        return currentEntries[nextIndex].query;
      } else {
        // direction === 'down'
        if (historyIndex <= -1) return null; // Already at bottom
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        if (nextIndex === -1) {
          // Returned to "live" input — restore stashed text
          return stashedInputRef.current;
        }
        return currentEntries[nextIndex].query;
      }
    },
    [historyIndex],
  );

  /**
   * Reset navigation state. Call when user types a character or closes the palette.
   */
  const resetNavigation = useCallback(() => {
    setHistoryIndex(-1);
    stashedInputRef.current = "";
  }, []);

  /** Top N entries for zero-state display */
  const recentDisplay = entries.slice(0, MAX_DISPLAY);

  /**
   * Get the last meaningful query if it was recorded within the past 30 seconds.
   * Used to pre-fill the input when the modal is reopened quickly (flow-state preservation).
   * Returns null if no recent query exists or the window has expired.
   */
  const getLastQuery = useCallback((): { query: string; mode: string } | null => {
    const last = lastQueryRef.current;
    if (!last) return null;
    if (Date.now() - last.timestamp > REPOPULATE_WINDOW_MS) return null;
    return { query: last.query, mode: last.mode };
  }, []);

  return {
    entries,
    recentDisplay,
    addEntry,
    clearHistory,
    historyIndex,
    navigateHistory,
    resetNavigation,
    getLastQuery,
  };
};
