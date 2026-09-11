/**
 * useSearchHistory — persistent search history with terminal-style ↑/↓ recall.
 *
 * Design decisions:
 * - Stored on the account, not in the browser. A search history is a list of
 *   the things somebody looked for, and `localStorage` is keyed by origin: two
 *   people using one browser shared the list, and clearing it cleared both.
 *   It also now follows the person to another device, which is what makes
 *   "that query I ran yesterday" work at all.
 * - Case-insensitive deduplication: "VCs in SF" and "vcs in sf" are the same.
 * - Max 20 stored, max 5 displayed in the zero state. The extra headroom keeps
 *   the display list from feeling stale after a few evictions.
 * - Terminal-style ↑/↓: `historyIndex` tracks position in the stack. -1 is not
 *   navigating, 0 is the most recent entry. `navigateHistory` returns the query
 *   to fill into the input, or null at the bounds.
 *
 * @module src/hooks/useSearchHistory
 */
import { useState, useCallback, useRef } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import type { SearchHistoryEntry } from "../api/preferences";

export type { SearchHistoryEntry };

/** Duration in ms within which reopening the palette restores the last query. */
const REPOPULATE_WINDOW_MS = 30_000;

const MAX_STORED = 20;
const MAX_DISPLAY = 5;

/** The server refuses anything longer, so trim rather than lose the entry. */
const MAX_QUERY_LENGTH = 200;

export const useSearchHistory = () => {
  const { preferences, setPreference } = usePreferences();
  const entries = preferences.searchHistory;

  const [historyIndex, setHistoryIndex] = useState(-1);
  // Stash the user's typed text before they started ↑/↓, so ↓ past 0 restores it.
  const stashedInputRef = useRef<string>("");
  // The last meaningful query, for the 30s re-populate on modal reopen.
  const lastQueryRef = useRef<{
    query: string;
    mode: string;
    timestamp: number;
  } | null>(null);

  // `entries` in a ref as well, so `addEntry` and `navigateHistory` read the
  // current list without being rebuilt on every keystroke that changes it.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /**
   * Record a successful search. Deduplicates case-insensitively, caps at
   * MAX_STORED. Only call after confirming the search returned something.
   */
  const addEntry = useCallback(
    (query: string, mode: "normal" | "ai" | "action") => {
      const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (trimmed.length < 2) return; // Don't record trivially short queries.

      const timestamp = Date.now();
      lastQueryRef.current = { query: trimmed, mode, timestamp };

      const deduped = entriesRef.current.filter(
        (e) => e.query.toLowerCase() !== trimmed.toLowerCase(),
      );
      const updated: SearchHistoryEntry[] = [
        { query: trimmed, mode, timestamp },
        ...deduped,
      ].slice(0, MAX_STORED);
      setPreference("searchHistory", updated);
    },
    [setPreference],
  );

  /** Clear all search history. */
  const clearHistory = useCallback(() => {
    setPreference("searchHistory", []);
    setHistoryIndex(-1);
  }, [setPreference]);

  /**
   * Terminal-style ↑/↓ navigation through history.
   *
   * @param direction - 'up' to go back in history, 'down' to go forward
   * @param currentInput - the current search input value (stashed on first ↑)
   * @returns the query string to fill into the input, or null if at bounds
   */
  const navigateHistory = useCallback(
    (direction: "up" | "down", currentInput: string): string | null => {
      const currentEntries = entriesRef.current;
      if (currentEntries.length === 0) return null;

      if (direction === "up") {
        const nextIndex = historyIndex + 1;
        if (nextIndex >= currentEntries.length) return null; // At oldest entry.
        if (historyIndex === -1) stashedInputRef.current = currentInput;
        setHistoryIndex(nextIndex);
        return currentEntries[nextIndex].query;
      }

      if (historyIndex <= -1) return null; // Already at the bottom.
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      // Back at the "live" input — restore the stashed text.
      if (nextIndex === -1) return stashedInputRef.current;
      return currentEntries[nextIndex].query;
    },
    [historyIndex],
  );

  /** Reset navigation state. Call when the user types or closes the palette. */
  const resetNavigation = useCallback(() => {
    setHistoryIndex(-1);
    stashedInputRef.current = "";
  }, []);

  /** Top N entries for the zero-state display. */
  const recentDisplay = entries.slice(0, MAX_DISPLAY);

  /**
   * The last meaningful query, if it was recorded in the past 30 seconds.
   *
   * Used to pre-fill the input when the modal is reopened quickly. Returns null
   * when there is no recent query or the window has expired.
   */
  const getLastQuery = useCallback((): {
    query: string;
    mode: string;
  } | null => {
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
