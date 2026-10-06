// Per-account preferences: list density, the recent-contacts limit, dedupe
// sensitivity, the temperature unit, the search history and the rest below.
// They live in `user_settings`, one row each, and the browser keeps only a
// cache it may lose. `localStorage` would be wrong twice over on a shared
// instance: it is per browser, so a laptop's choice never reaches the phone,
// and it is keyed by origin, not account, so two people signing in and out of
// one browser would share every key, a search history included. Keys are
// namespaced `pref.`, so the table can hold other things without collisions.

import { z } from "zod";
import { sqlite } from "../db.ts";
import { CADENCE_DAYS } from "../../shared/cadence.ts";
import { engineChoiceSchema } from "../../shared/webSearchEngine.ts";

// The shape

/** Which palette the app paints. `system` follows the operating system. */
export const THEME_MODES = ["light", "dark", "system"] as const;
/** The built-in accent. Every derived token is computed from this one value. */
export const DEFAULT_ACCENT = "#006a91";

export const PULSE_COLUMNS = ["focus", "network", "intel"] as const;
export type PulseColumn = (typeof PULSE_COLUMNS)[number];

export const PULSE_CARD_IDS = [
  "up-next",
  "completed",
  "keeping-up",
  "activity",
  "composition",
  "insight",
  "inbox",
  "coming-up",
] as const;
export const KNOWN_PULSE_CARD_IDS: ReadonlySet<string> = new Set(
  PULSE_CARD_IDS,
);

export interface PulseLayout {
  hidden: string[];
  order: Partial<Record<PulseColumn, string[]>>;
}

export const pulseLayoutSchema = z
  .object({
    hidden: z.array(z.string().max(40)).max(20),
    order: z.partialRecord(
      z.enum(PULSE_COLUMNS),
      z.array(z.string().max(40)).max(20),
    ),
  })
  .transform((val): PulseLayout => ({
    hidden: val.hidden.filter((id) => KNOWN_PULSE_CARD_IDS.has(id)),
    order: Object.fromEntries(
      Object.entries(val.order).map(([col, ids]) => [
        col,
        (ids ?? []).filter((id) => KNOWN_PULSE_CARD_IDS.has(id)),
      ]),
    ),
  }));

/**
 * Every preference and what its value may be. One schema each, used twice: to
 * validate a PATCH and to parse a stored row back, since a row written by
 * another version may hold a value this one refuses. A preference that is not
 * here cannot be stored, so the table grows no keys nobody reads.
 *
 * NO `.default()` ANYWHERE. A defaulted field inside `.partial()` fills itself
 * in when absent, so a PATCH naming one preference would arrive naming all
 * seven and mark each one chosen. The defaults have their own object below,
 * where they cannot leak into a request body.
 */
export const preferenceSchemas = {
  theme: z.enum(THEME_MODES),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "An accent is a six-digit hex color")
    .transform((hex) => hex.toLowerCase()),
  listDensity: z.enum(["comfortable", "compact"]),
  recentLimit: z.number().int().min(0).max(10),
  dedupePreset: z.enum(["conservative", "default", "aggressive"]),
  tempUnit: z.enum(["celsius", "fahrenheit"]),
  pulseLayout: pulseLayoutSchema,
  askHistoryOpen: z.boolean(),
  mapPaneOpen: z.boolean(),
  /**
   * A stored "health" layer, or one in a PATCH from an old page, reads as Pins,
   * so neither fails to load.
   */
  mapLayer: z.preprocess(
    (value) => (value === "health" ? "pins" : value),
    z.enum(["pins", "heat"]),
  ),
  startPage: z.enum(["network", "pulse"]),
  listSort: z.enum(["name", "recent"]),
  /**
   * The accepted days, not only the four the menus offer: a row saved at 60 or
   * 180, once choices too, must still parse, or the account would quietly fall
   * back to 90.
   */
  defaultCadenceDays: z.literal(CADENCE_DAYS),
  /**
   * Contacts a person creates by hand start tracked. Imports and connectors
   * never do, whatever this says.
   */
  trackNewContacts: z.boolean(),
  weekStart: z.enum(["monday", "sunday"]),
  showWeather: z.boolean(),
  textScale: z.enum(["default", "large"]),
  motion: z.enum(["system", "reduced"]),
  mascotMotion: z.enum(["full", "subtle", "off"]),
  singleKeyShortcuts: z.boolean(),
  aiAssist: z.boolean(),
  dedupeOnCreate: z.boolean(),
  dedupeOnImport: z.boolean(),
  autoEnrich: z.boolean(),
  /**
   * The web search engine contact research uses for this account: "default"
   * follows the instance's engine, or the account names its own.
   */
  webSearchEngine: engineChoiceSchema,
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
  return {
    ...DEFAULTS,
    pulseLayout: { hidden: [], order: {} },
    askHistoryOpen: true,
  };
}

// Storage

const PREFIX = "pref.";

const _selectPrefStmt = sqlite.prepare(
  // tenant-lint: allow user-owned settings
  `SELECT key, value FROM user_settings WHERE userId = ? AND key LIKE 'pref.%'`,
);

const _upsertPrefStmt = sqlite.prepare(
  // tenant-lint: allow user-owned settings
  `INSERT INTO user_settings (userId, key, value, updatedAt)
   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(userId, key)
   DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`,
);

const _deletePrefStmt = sqlite.prepare(
  // tenant-lint: allow user-owned settings
  "DELETE FROM user_settings WHERE userId = ? AND key = ?",
);

/** What this account has actually chosen, ignoring anything unreadable. */
function readStored(userId: string): Partial<Preferences> {
  const rows = _selectPrefStmt.all(userId) as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};

  for (const row of rows) {
    const key = row.key.slice(PREFIX.length) as PreferenceKey;
    const schema = preferenceSchemas[key];
    // A key this version does not know, or a value it refuses, is skipped, not
    // thrown, so one bad row cannot leave the app unable to read its settings.
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
 * Write the named preferences and return the whole set, in one transaction, so
 * a PATCH lands whole or not at all. Values are stored as JSON, so a string, a
 * number and an array read back as what they were.
 */
export function setPreferences(
  userId: string,
  patch: Partial<Preferences>,
): Preferences {
  const write = sqlite.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      _upsertPrefStmt.run(userId, PREFIX + key, JSON.stringify(value));
    }
  });
  write();
  return getPreferences(userId);
}

/**
 * Remove a stored preference for this account, reverting it to the default.
 */
export function deletePreference(
  userId: string,
  key: PreferenceKey,
): Preferences {
  _deletePrefStmt.run(userId, PREFIX + key);
  return getPreferences(userId);
}
