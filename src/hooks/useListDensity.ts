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
 * Stored on the account rather than in the browser, so the choice follows the
 * person to their phone. See contexts/PreferencesContext.
 *
 * @module hooks/useListDensity
 */
import { useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import type { ListDensity } from "../api/preferences";

export type { ListDensity };

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

export function useListDensity() {
  const { preferences, setPreference } = usePreferences();
  const density = preferences.listDensity;

  const setDensity = useCallback(
    (next: ListDensity) => setPreference("listDensity", next),
    [setPreference],
  );

  return { density, setDensity, metrics: DENSITY_METRICS[density] };
}
