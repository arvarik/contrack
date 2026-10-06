/**
 * The duplicate sensitivity preset this account has chosen:
 *
 *   - "aggressive"   → more auto-merges, fewer manual reviews
 *   - "default"      → balanced (high confidence only)
 *   - "conservative" → only near-certain matches auto-merge
 *
 * The browser names the preset and nothing else. The number each preset
 * stands for lives in `server/services/dedupe/policy.ts`, so a scan, an
 * import and a single-contact check always agree on it.
 */
import { useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import type { MergePreset } from "../api/preferences";

export function useDedupeSettings() {
  const { preferences, setPreference } = usePreferences();
  const preset = preferences.dedupePreset;

  const setPreset = useCallback(
    (next: MergePreset) => setPreference("dedupePreset", next),
    [setPreference],
  );

  return { preset, setPreset };
}
