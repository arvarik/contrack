/**
 * The keys 1.x left in this browser.
 *
 * 1.x kept five settings in `localStorage`. 2.0 keeps them on the account and
 * does not read the old values, so a browser that ran 1.x starts from the
 * defaults. The keys are still removed. `localStorage` is keyed by origin, so
 * whoever signs in next in the same browser could read what is left behind,
 * and the search history most of all.
 *
 * @module lib/forgetLegacyKeys
 */

/** The 1.x key names, kept here so the removal and its test cannot disagree. */
export const LEGACY_KEYS = {
  listDensity: "contrack_list_density",
  recentLimit: "contrack_recent_limit",
  dedupePreset: "contrack_dedupe_settings",
  tempUnit: "contrack_temp_unit",
  searchHistory: "contrack:search:history",
} as const;

/** Remove every key 1.x wrote. It does nothing when the browser has none. */
export function forgetLegacyKeys(): void {
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage is unavailable, so there was nothing to remove.
    }
  }
}
