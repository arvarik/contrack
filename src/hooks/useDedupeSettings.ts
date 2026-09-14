/**
 * useDedupeSettings — the sensitivity preset this account has chosen.
 *
 * Presets:
 *   - "aggressive"   → more auto-merges, fewer manual reviews
 *   - "default"      → balanced (high confidence only)
 *   - "conservative" → only near-certain matches auto-merge
 *
 * Stored on the account. The number each preset stands for lives on the
 * server, in `server/services/dedupe/policy.ts`, and the server reads it
 * for every scan, every import and every single-contact check. This hook
 * used to carry a copy of that table and send the number with each scan
 * request, which meant the import path and the scan could disagree about
 * what the preset meant. The browser now names the preset and nothing else.
 *
 * The migration out of localStorage understands the old raw-threshold shape
 * as well as the preset one, so somebody who last touched this when it was a
 * slider keeps their choice — see lib/localPreferenceMigration.
 *
 * @module hooks/useDedupeSettings
 */
import { useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import type { MergePreset } from "../api/preferences";

export type { MergePreset };

export function useDedupeSettings() {
  const { preferences, setPreference } = usePreferences();
  const preset = preferences.dedupePreset;

  const setPreset = useCallback(
    (next: MergePreset) => setPreference("dedupePreset", next),
    [setPreference],
  );

  return { preset, setPreset };
}
