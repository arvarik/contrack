/**
 * Preferences API client.
 *
 * These settings used to be `localStorage` keys. They now live on the account,
 * so they follow it to another device and cannot be read by whoever signs in
 * next on the same browser.
 *
 * `apiJson` rather than a bare fetch: a 401 here means the same thing it means
 * anywhere else in the app and has to reach AuthGate.
 *
 * @module api/preferences
 */
import { apiJson, jsonBody } from "./client";

/** Which palette the app paints. `system` follows the operating system. */
export type ThemeMode = "light" | "dark" | "system";
export type ListDensity = "comfortable" | "compact";
export type MergePreset = "conservative" | "default" | "aggressive";
export type TempUnit = "celsius" | "fahrenheit";

export interface SearchHistoryEntry {
  query: string;
  mode: "normal" | "ai" | "action";
  /** Epoch milliseconds. */
  timestamp: number;
}

export interface Preferences {
  theme: ThemeMode;
  /** `#rrggbb`. The primary and container tokens are derived from it. */
  accent: string;
  listDensity: ListDensity;
  recentLimit: number;
  dedupePreset: MergePreset;
  tempUnit: TempUnit;
  searchHistory: SearchHistoryEntry[];
}

export interface PreferencesResponse {
  preferences: Preferences;
  /**
   * The keys this account has actually chosen.
   *
   * The difference between "the default, because nobody said" and "the
   * default, because somebody chose it" is what makes the one-time migration
   * out of localStorage safe: a key that is already stored is never
   * overwritten by whatever the browser happens to be holding.
   */
  stored: (keyof Preferences)[];
}

/**
 * What the app uses when nobody has chosen.
 *
 * A copy of the server's defaults, because the app renders before the first
 * response arrives and a list that jumps from comfortable to compact a moment
 * after it paints is worse than one that waits. `tests/unit/preferences.test.ts`
 * asserts this object equals the server's, so the copy cannot drift.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  accent: "#006a91",
  listDensity: "comfortable",
  recentLimit: 3,
  dedupePreset: "default",
  tempUnit: "celsius",
  searchHistory: [],
};

export const fetchPreferences = (): Promise<PreferencesResponse> =>
  apiJson<PreferencesResponse>("/auth/preferences");

export const savePreferences = (
  patch: Partial<Preferences>,
): Promise<PreferencesResponse> =>
  apiJson<PreferencesResponse>("/auth/preferences", {
    method: "PATCH",
    ...jsonBody(patch),
  });
