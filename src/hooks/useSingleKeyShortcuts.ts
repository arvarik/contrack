/**
 * Whether single-key shortcuts (`/`, `n`, `v`, `j`, `k`) are on, from the
 * account's `singleKeyShortcuts` preference. When false, their window-level
 * handlers return early.
 */
import { usePreferences } from "../contexts/PreferencesContext";

export function useSingleKeyShortcuts(): boolean {
  const { preferences } = usePreferences();
  return preferences.singleKeyShortcuts;
}
