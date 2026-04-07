/**
 * useRecentContacts — Tracks the last N visited contact IDs in sessionStorage.
 *
 * Design:
 * - sessionStorage scoped: clears on browser tab close, not across sessions
 *   (more appropriate than localStorage for "recent" which should feel transient)
 * - De-duplicates: visiting a contact that's already in recent moves it to the front
 * - Stores up to MAX_STORED=10; display limit is user-configurable (default 3)
 * - Gracefully handles JSON parse errors (corrupted storage)
 *
 * Usage:
 *   const { recentIds, recordVisit, clearRecent } = useRecentContacts();
 *   // In a navigation handler:
 *   recordVisit(contactId);
 *   // In the UI:
 *   const recentContacts = contacts.filter(c => recentIds.includes(c.id));
 */
import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "contrack_recent_contacts";
const LIMIT_KEY = "contrack_recent_limit";

/** Max entries to store in the ring buffer — always store more than we show so the ring doesn't shrink */
const MAX_STORED = 10;

/** Default number of recent contacts visible in the Network sidebar strip */
export const DEFAULT_RECENT_LIMIT = 3;

/** Min/max for the user-configurable limit */
export const MIN_RECENT_LIMIT = 1;
export const MAX_RECENT_LIMIT = 10;

const readFromStorage = (): string[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Corrupted storage — reset gracefully
    return [];
  }
};

const writeToStorage = (ids: string[]): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage quota exceeded — fail silently, recents are non-critical
  }
};

// ---------------------------------------------------------------------------
// useRecentContactsLimit — read/write the display limit preference
// ---------------------------------------------------------------------------

/**
 * Reads and persists the user's preferred number of recent contacts to show.
 * Stored in localStorage (survives sessions) and fires a storage event so
 * all mounted ContactList instances update without a page reload.
 */
export const useRecentContactsLimit = () => {
  const readLimit = (): number => {
    try {
      const stored = localStorage.getItem(LIMIT_KEY);
      if (!stored) return DEFAULT_RECENT_LIMIT;
      const n = parseInt(stored, 10);
      return isNaN(n) ? DEFAULT_RECENT_LIMIT : Math.min(Math.max(n, MIN_RECENT_LIMIT), MAX_RECENT_LIMIT);
    } catch {
      return DEFAULT_RECENT_LIMIT;
    }
  };

  const [limit, setLimitState] = useState<number>(readLimit);

  const setLimit = (n: number): void => {
    const clamped = Math.min(Math.max(Math.round(n), MIN_RECENT_LIMIT), MAX_RECENT_LIMIT);
    try {
      localStorage.setItem(LIMIT_KEY, String(clamped));
      // Notify other components (ContactList) that the preference changed
      window.dispatchEvent(new Event('contrack_settings_changed'));
    } catch {
      // Ignore quota errors
    }
    setLimitState(clamped);
  };

  // Stay in sync if another tab or component changes the preference
  useEffect(() => {
    const handler = () => setLimitState(readLimit());
    window.addEventListener('contrack_settings_changed', handler);
    return () => window.removeEventListener('contrack_settings_changed', handler);
  }, []);

  return { limit, setLimit };
};

export const useRecentContacts = () => {
  // Mirror storage in state so components re-render when recents change
  const [recentIds, setRecentIds] = useState<string[]>(readFromStorage);

  /**
   * Record a contact visit. Moves existing entries to front, caps at MAX_RECENT.
   * Safe to call on every contact navigation.
   */
  const recordVisit = useCallback((id: string) => {
    setRecentIds((prev) => {
      const deduped = prev.filter((existing) => existing !== id);
      const updated = [id, ...deduped].slice(0, MAX_STORED);
      writeToStorage(updated);
      return updated;
    });
  }, []);

  /**
   * Clear all recent contacts — useful for privacy or testing.
   */
  const clearRecent = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setRecentIds([]);
  }, []);

  return { recentIds, recordVisit, clearRecent };
};
