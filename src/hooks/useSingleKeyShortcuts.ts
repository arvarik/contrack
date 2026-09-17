/**
 * useSingleKeyShortcuts — whether single-key (bare-letter) shortcuts are active.
 *
 * Controlled by the account's `singleKeyShortcuts` preference. When false,
 * window-level single-key shortcuts like `/`, `n`, `v`, `j`, `k` return early.
 *
 * @module hooks/useSingleKeyShortcuts
 */
import { usePreferences } from "../contexts/PreferencesContext";

export function useSingleKeyShortcuts(): boolean {
  const { preferences } = usePreferences();
  return preferences.singleKeyShortcuts;
}
