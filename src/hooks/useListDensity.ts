/**
 * useListDensity — how tightly the contact list packs its rows.
 *
 * The default row spends 72px on a 48px avatar, a name, and a company, which
 * shows about eight people per phone screen. That is comfortable for a network
 * of thirty and painful for a network of five hundred, where finding someone
 * means scrolling sixty screens. Compact roughly doubles the rows per screen
 * without dropping any information — the avatar shrinks and the padding
 * tightens, but the same fields are shown.
 *
 * Persisted in localStorage and broadcast on the shared settings event, so the
 * list re-renders the moment the preference changes in Settings rather than on
 * the next reload.
 *
 * @module hooks/useListDensity
 */
import { useCallback, useEffect, useState } from "react";
import { SETTINGS_CHANGED_EVENT, emitSettingsChanged } from "../lib/appEvents";

const STORAGE_KEY = "contrack_list_density";

export type ListDensity = "comfortable" | "compact";

const DEFAULT_DENSITY: ListDensity = "comfortable";

/**
 * Row geometry per density.
 *
 * `rowHeight` is what the virtualizer uses for its initial estimate. It only
 * has to be close — rows are measured for real via `measureElement` — but a
 * bad estimate makes the scrollbar jump as the user scrolls into unmeasured
 * territory, so it is worth keeping honest.
 */
export const DENSITY_METRICS: Record<
  ListDensity,
  { rowHeight: number; avatarSize: number }
> = {
  comfortable: { rowHeight: 72, avatarSize: 48 },
  compact: { rowHeight: 52, avatarSize: 34 },
};

function readDensity(): ListDensity {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "compact" || stored === "comfortable"
      ? stored
      : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

export function useListDensity() {
  const [density, setDensityState] = useState<ListDensity>(readDensity);

  const setDensity = useCallback((next: ListDensity) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
      emitSettingsChanged();
    } catch {
      // Ignore quota errors — the in-memory value below still applies.
    }
    setDensityState(next);
  }, []);

  // Stay in sync when the preference changes elsewhere (Settings, another tab).
  useEffect(() => {
    const handler = () => setDensityState(readDensity());
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler);
  }, []);

  return { density, setDensity, metrics: DENSITY_METRICS[density] };
}
