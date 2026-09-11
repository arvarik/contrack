// =============================================================================
// User preferences — the per-account settings a browser used to keep
// =============================================================================
// List density, the recent-contacts limit, the dedupe sensitivity, the
// temperature unit and the search history all lived in `localStorage`. That is
// wrong in two ways on a shared instance.
//
// It is per browser, so the preference a person sets on their laptop does not
// reach their phone, and a fresh profile starts over.
//
// And `localStorage` is keyed by origin, not by account. Two people signing in
// and out of one instance in one browser share every key: sign out, sign in as
// somebody else, and their list is compact because yours was, their search
// history is yours, and clearing it clears yours too. Nothing here is a secret,
// but a search history is a list of the things somebody looked for.
//
// So they live in `user_settings`, one row per preference, and the browser
// keeps only a cache it is free to lose. The table already existed and was
// empty; this is its first use.
//
// Each key is namespaced `pref.` so a later feature can put something in this
// table that is not a preference without either colliding or having to guess.
// =============================================================================

import { z } from "zod";
import { sqlite } from "../db.ts";

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** Which palette the app paints. `system` follows the operating system. */
export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** The built-in accent. Every derived token is computed from this one value. */
export const DEFAULT_ACCENT = "#006a91";

/** Search history never grows past this, on the server or in the browser. */
export const MAX_SEARCH_HISTORY = 20;

/** One recorded search. The browser reads these back as ↑/↓ history. */
const searchHistoryEntrySchema = z.object({
  query: z.string().trim().min(1).max(200),
  mode: z.enum(["normal", "ai", "action"]),
  /** Epoch milliseconds. Written by the browser, so it is not trusted for order. */
  timestamp: z.number().int().nonnegative(),
});

export type SearchHistoryEntry = z.infer<typeof searchHistoryEntrySchema>;

/**
 * Every preference, and what each value may be.
 *
 * One schema per preference, used twice: to validate a PATCH, and to parse a
 * stored row back — a row written by an older version can hold a value this
 * one no longer accepts. A preference that is not here cannot be stored, which
 * is what stops this table growing keys nobody reads.
 *
 * NO `.default()` ANYWHERE. A defaulted field inside `.partial()` still fills
 * itself in when the key is absent, so a PATCH naming one preference would
 * arrive at the route naming all seven and mark every one of them chosen. The
 * defaults live in their own object below, where they cannot leak into a
 * request body.
 */
export const preferenceSchemas = {
  theme: z.enum(THEME_MODES),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "An accent is a six-digit hex colour")
    .transform((hex) => hex.toLowerCase()),
  listDensity: z.enum(["comfortable", "compact"]),
  recentLimit: z.number().int().min(0).max(10),
  dedupePreset: z.enum(["conservative", "default", "aggressive"]),
  tempUnit: z.enum(["celsius", "fahrenheit"]),
  searchHistory: z.array(searchHistoryEntrySchema).max(MAX_SEARCH_HISTORY),
} as const;

export type PreferenceKey = keyof typeof preferenceSchemas;

export const PREFERENCE_KEYS = Object.keys(
  preferenceSchemas,
) as PreferenceKey[];

/** The full set, as the API hands it out. */
export type Preferences = {
  [K in PreferenceKey]: z.infer<(typeof preferenceSchemas)[K]>;
};

/** What the app uses when nobody has chosen. */
const DEFAULTS: Preferences = {
  theme: "system",
  accent: DEFAULT_ACCENT,
  listDensity: "comfortable",
  recentLimit: 3,
  dedupePreset: "default",
  tempUnit: "celsius",
  searchHistory: [],
};

/** A PATCH body: any subset, and nothing else. */
export const preferencesPatchSchema = z
  .object(preferenceSchemas)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Name at least one preference to change",
  });

/** The defaults, freshly built. Never share one object between callers. */
export function defaultPreferences(): Preferences {
  return { ...DEFAULTS, searchHistory: [] };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const PREFIX = "pref.";

const selectStmt = () =>
  sqlite.prepare(
    // tenant-lint: allow user-owned settings
    `SELECT key, value FROM user_settings WHERE userId = ? AND key LIKE 'pref.%'`,
  );

const upsertStmt = () =>
  sqlite.prepare(
    // tenant-lint: allow user-owned settings
    `INSERT INTO user_settings (userId, key, value, updatedAt)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(userId, key)
     DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`,
  );

/** What this account has actually chosen, ignoring anything unreadable. */
function readStored(userId: string): Partial<Preferences> {
  const rows = selectStmt().all(userId) as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};

  for (const row of rows) {
    const key = row.key.slice(PREFIX.length) as PreferenceKey;
    const schema = preferenceSchemas[key];
    // A key this version does not know, or a value it no longer accepts, is
    // skipped rather than thrown. The alternative is that one bad row from an
    // older release makes the whole app unable to read its own settings.
    if (!schema) continue;
    try {
      const parsed = schema.safeParse(JSON.parse(row.value));
      if (parsed.success) stored[key] = parsed.data;
    } catch {
      // Not JSON. Same answer.
    }
  }

  return stored as Partial<Preferences>;
}

/** This account's preferences, with defaults filling every gap. */
export function getPreferences(userId: string): Preferences {
  return { ...defaultPreferences(), ...readStored(userId) };
}

/** The keys this account has chosen, as opposed to inherited from the default. */
export function storedPreferenceKeys(userId: string): PreferenceKey[] {
  return PREFERENCE_KEYS.filter((key) => key in readStored(userId));
}

/**
 * Write the named preferences and return the whole set.
 *
 * One transaction, so a PATCH naming four preferences either lands or does
 * not. Values are stored as JSON so a string, a number and an array all read
 * back as what they were, rather than as text that has to be guessed at.
 */
export function setPreferences(
  userId: string,
  patch: Partial<Preferences>,
): Preferences {
  const upsert = upsertStmt();
  const write = sqlite.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      upsert.run(userId, PREFIX + key, JSON.stringify(value));
    }
  });
  write();
  return getPreferences(userId);
}
