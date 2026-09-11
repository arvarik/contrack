/**
 * useDedupeSettings — the confidence a pair needs before Contrack merges it
 * without asking.
 *
 * Presets:
 *   - "aggressive"   → 0.88 — more auto-merges, fewer manual reviews
 *   - "default"      → 0.93 — balanced (high confidence only)
 *   - "conservative" → 0.97 — only near-certain matches auto-merge
 *
 * Stored on the account. The migration out of localStorage understands the old
 * raw-threshold shape as well as the preset one, so somebody who last touched
 * this when it was a slider keeps their choice — see lib/localPreferenceMigration.
 *
 * @module hooks/useDedupeSettings
 */
import { useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import type { MergePreset } from "../api/preferences";

export type { MergePreset };

/** Maps each preset to its numeric confidence threshold. */
export const PRESET_THRESHOLDS: Record<MergePreset, number> = {
  aggressive: 0.88,
  default: 0.93,
  conservative: 0.97,
};

export function useDedupeSettings() {
  const { preferences, setPreference } = usePreferences();
  const preset = preferences.dedupePreset;

  const setPreset = useCallback(
    (next: MergePreset) => setPreference("dedupePreset", next),
    [setPreference],
  );

  return {
    preset,
    autoMergeThreshold: PRESET_THRESHOLDS[preset],
    setPreset,
  };
}
