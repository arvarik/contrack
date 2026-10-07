/**
 * How tightly the contact list packs its rows. The default row spends 72 px
 * on a 48 px avatar, a name and a company, about eight people per phone
 * screen. Compact rows are 52 px with the same fields, about eleven people:
 * the avatar shrinks and the padding tightens. Stored on the account, so the
 * choice follows the person to their phone (contexts/PreferencesContext).
 */
import { useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import type { ListDensity } from "../api/preferences";

export type { ListDensity };

/**
 * Row geometry per density. `rowHeight` is the virtualizer's first estimate.
 * Rows are measured for real (`measureElement`), but a bad estimate makes
 * the scrollbar jump in unmeasured territory.
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
