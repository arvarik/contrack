/**
 * useRecentContacts — the last N contacts this tab visited, and how many of
 * them the Network sidebar pins.
 *
 * Two different things, stored two different ways on purpose.
 *
 * The visit list is per tab: it lives in `sessionStorage` and clears when the
 * tab closes, because "recent" that survives a week is not recent. It is keyed
 * by account id, so signing out and in as somebody else does not show their
 * Network a list of ids they cannot open.
 *
 * The limit is a preference, so it lives on the account and follows it to
 * another device. See contexts/PreferencesContext.
 *
 * @module hooks/useRecentContacts
 */
import { useState, useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import { useAuth } from "../components/auth/AuthGate";

const STORAGE_PREFIX = "contrack_recent_contacts";

/** Max entries to store — always more than we show, so the ring cannot shrink. */
const MAX_STORED = 10;

/** Default number of recent contacts visible in the Network sidebar strip. */
export const DEFAULT_RECENT_LIMIT = 3;

/** Min/max for the user-configurable limit. */
export const MIN_RECENT_LIMIT = 0;
export const MAX_RECENT_LIMIT = 10;

/**
 * One key per account.
 *
 * `sessionStorage` is per tab, not per account, so signing out and in as
 * somebody else in the same tab used to hand the new account the previous
 * one's list of contact ids. They resolve to nothing — every read is scoped
 * server-side — so the visible symptom was an empty strip, but the ids were
 * still there to read.
 */
const storageKey = (accountId: string | null) =>
  `${STORAGE_PREFIX}:${accountId ?? "local"}`;

const readFromStorage = (key: string): string[] => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    // Corrupted storage — reset gracefully.
    return [];
  }
};

const writeToStorage = (key: string, ids: string[]): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage quota exceeded — fail silently, recents are non-critical.
  }
};

// ---------------------------------------------------------------------------
// useRecentContactsLimit — how many are pinned
// ---------------------------------------------------------------------------

export const useRecentContactsLimit = () => {
  const { preferences, setPreference } = usePreferences();

  const setLimit = useCallback(
    (n: number) =>
      setPreference(
        "recentLimit",
        Math.min(Math.max(Math.round(n), MIN_RECENT_LIMIT), MAX_RECENT_LIMIT),
      ),
    [setPreference],
  );

  return { limit: preferences.recentLimit, setLimit };
};

// ---------------------------------------------------------------------------
// useRecentContacts — which ones
// ---------------------------------------------------------------------------

export const useRecentContacts = () => {
  const { user } = useAuth();
  const key = storageKey(user?.id ?? null);
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    readFromStorage(key),
  );

  /**
   * Record a contact visit. Moves existing entries to the front, caps at
   * MAX_STORED. Safe to call on every contact navigation.
   */
  const recordVisit = useCallback(
    (id: string) => {
      setRecentIds((prev) => {
        const deduped = prev.filter((existing) => existing !== id);
        const updated = [id, ...deduped].slice(0, MAX_STORED);
        writeToStorage(key, updated);
        return updated;
      });
    },
    [key],
  );

  /** Clear all recent contacts — useful for privacy or testing. */
  const clearRecent = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing to remove.
    }
    setRecentIds([]);
  }, [key]);

  return { recentIds, recordVisit, clearRecent };
};
