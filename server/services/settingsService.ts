// =============================================================================
// Settings Service — persisted app configuration (key/value JSON)
// =============================================================================
// Backs the AI capability configuration (provider keys, custom endpoints,
// capability assignments, cached model lists). Values are JSON blobs stored
// in the `app_settings` table created in db.ts.
//
// Reads are cached in memory because they sit on the AI request path; the
// cache is invalidated on every write (single process, single writer).
// =============================================================================

import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

interface SettingRow {
  value: string;
}

/** In-memory cache of parsed setting values. `undefined` = not yet read. */
const cache = new Map<string, unknown>();

/** Read a setting, or `null` when unset/unparseable. */
export function getSetting<T>(key: string): T | null {
  if (cache.has(key)) return (cache.get(key) as T) ?? null;
  try {
    const row = sqlite
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(key) as SettingRow | undefined;
    const parsed = row?.value ? (JSON.parse(row.value) as T) : null;
    cache.set(key, parsed);
    return parsed;
  } catch (err) {
    log.warn("Settings", `Failed to read "${key}": ${getErrorMessage(err)}`);
    return null;
  }
}

/** Write a setting (JSON-serialized). */
export function setSetting(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  sqlite
    .prepare(
      `INSERT INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    )
    .run(key, json, new Date().toISOString());
  cache.set(key, value);
}

/** Delete a setting. */
export function deleteSetting(key: string): void {
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  cache.delete(key);
}

/** Drop the in-memory cache (used by tests and after external mutations). */
export function clearSettingsCache(): void {
  cache.clear();
}

// =============================================================================
// Known setting keys
// =============================================================================

export const SETTING_KEYS = {
  /** Record<capability, CapabilityAssignment> */
  aiCapabilities: "ai.capabilities",
  /** Record<providerId, string> — API keys entered through the UI */
  aiProviderKeys: "ai.providerKeys",
  /** CustomEndpointConfig[] — user-defined OpenAI-compatible endpoints */
  aiCustomEndpoints: "ai.customEndpoints",
  /** Record<providerId, CachedModelList> */
  aiModelCache: "ai.modelCache",
  /** { url: string } — self-hosted SearXNG instance for research */
  aiSearxng: "ai.searxng",
  /** { model, dimension } — the embedding model the vec0 tables were built with */
  embeddingsState: "ai.embeddingsState",
} as const;
