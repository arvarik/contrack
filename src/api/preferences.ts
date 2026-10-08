/**
 * The account's preferences. They live on the account, so they follow it to
 * another device and stay hidden from the next person on the same browser.
 */
import { queryOptions } from "@tanstack/react-query";
import type { EngineChoice } from "../../shared/webSearchEngine";
import { apiJson, jsonBody } from "./client";

/** Which palette the app paints. `system` follows the operating system. */
type ThemeMode = "light" | "dark" | "system";
export type ListDensity = "comfortable" | "compact";
export type MergePreset = "conservative" | "default" | "aggressive";
type TempUnit = "celsius" | "fahrenheit";
type StartPage = "network" | "pulse";
type ListSort = "name" | "recent";
import type { CadenceDays } from "../../shared/cadence";
type WeekStart = "monday" | "sunday";
type TextScale = "default" | "large";
export type MotionPreference = "system" | "reduced";
/** How much the corvid moves. `off` is the static mark. */
export type MascotMotion = "full" | "subtle" | "off";

export type PulseColumn = "focus" | "network" | "intel";

export interface PulseLayout {
  hidden: string[];
  order: Partial<Record<PulseColumn, string[]>>;
}

export interface Preferences {
  theme: ThemeMode;
  /** `#rrggbb`. The primary and container tokens are derived from it. */
  accent: string;
  listDensity: ListDensity;
  recentLimit: number;
  dedupePreset: MergePreset;
  tempUnit: TempUnit;
  pulseLayout: PulseLayout;
  askHistoryOpen: boolean;
  mapPaneOpen: boolean;
  mapLayer: "pins" | "heat";
  startPage: StartPage;
  listSort: ListSort;
  defaultCadenceDays: CadenceDays;
  /** Contacts added by hand start tracked. Imports and connectors never do. */
  trackNewContacts: boolean;
  weekStart: WeekStart;
  showWeather: boolean;
  textScale: TextScale;
  motion: MotionPreference;
  mascotMotion: MascotMotion;
  singleKeyShortcuts: boolean;
  aiAssist: boolean;
  dedupeOnCreate: boolean;
  dedupeOnImport: boolean;
  autoEnrich: boolean;
  /** The web search engine research uses: "default" is the instance's. */
  webSearchEngine: EngineChoice;
}

export interface PreferencesResponse {
  preferences: Preferences;
  /**
   * The keys this account has chosen, which tells "the default, because
   * nobody said" from "the default, because somebody chose it".
   */
  stored: (keyof Preferences)[];
}

/**
 * A copy of the server's defaults, for the render before the first answer.
 * `tests/unit/frontend/preferences/preferencesClient.test.ts` holds it equal
 * to the server's.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  accent: "#006a91",
  listDensity: "comfortable",
  recentLimit: 3,
  dedupePreset: "default",
  tempUnit: "celsius",
  pulseLayout: {
    hidden: [],
    order: {},
  },
  askHistoryOpen: true,
  mapPaneOpen: true,
  mapLayer: "pins",
  startPage: "network",
  listSort: "name",
  defaultCadenceDays: 90,
  trackNewContacts: false,
  weekStart: "monday",
  showWeather: false,
  textScale: "default",
  motion: "system",
  mascotMotion: "full",
  singleKeyShortcuts: true,
  aiAssist: true,
  dedupeOnCreate: true,
  dedupeOnImport: true,
  autoEnrich: false,
  webSearchEngine: "default",
};

/**
 * Whether a value is the default for its key. "Stored" alone does not say
 * "changed": a setting set back by hand is stored at the default. Strings
 * compare without case (an accent arrives in either), objects by JSON.
 */
export function isDefaultValue<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): boolean {
  const fallback = DEFAULT_PREFERENCES[key];
  if (typeof value === "string" && typeof fallback === "string") {
    return value.toLowerCase() === fallback.toLowerCase();
  }
  if (typeof value === "object" || typeof fallback === "object") {
    return JSON.stringify(value) === JSON.stringify(fallback);
  }
  return value === fallback;
}

export const fetchPreferences = (): Promise<PreferencesResponse> =>
  apiJson<PreferencesResponse>("/auth/preferences");

/**
 * The account's preferences. PreferencesContext is the only writer, so a
 * refetch could only replace an optimistic value with a stale one. AuthGate
 * asks for them beside its first `/status`.
 */
export const preferencesQuery = queryOptions({
  queryKey: ["preferences"],
  queryFn: fetchPreferences,
  staleTime: Infinity,
  gcTime: Infinity,
});

export const savePreferences = (
  patch: Partial<Preferences>,
): Promise<PreferencesResponse> =>
  apiJson<PreferencesResponse>("/auth/preferences", {
    method: "PATCH",
    ...jsonBody(patch),
  });

export const deletePreference = (
  key: keyof Preferences,
): Promise<PreferencesResponse> =>
  apiJson<PreferencesResponse>(`/auth/preferences/${key}`, {
    method: "DELETE",
  });
