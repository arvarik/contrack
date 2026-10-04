import { sqlite } from "../../db.ts";

export const FAILURE_TTL_DAYS = 7;

// The migrations create geocode_cache, and server/db.ts has run them by the
// time this module loads.
const cacheStmts = {
  get: sqlite.prepare(
    `SELECT lat, lng, provider, success, createdAt, displayName FROM geocode_cache WHERE key = ?`,
  ),
  upsert: sqlite.prepare(`
    INSERT INTO geocode_cache (key, lat, lng, provider, success, displayName)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
      provider = excluded.provider, success = excluded.success,
      displayName = excluded.displayName, createdAt = CURRENT_TIMESTAMP
  `),
};

export function normalizeLocationKey(location: string): string {
  return location
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^,+|,+$/g, "");
}

interface CacheEntry {
  lat: number | null;
  lng: number | null;
  provider: string;
  success: number;
  createdAt: string;
  displayName: string | null;
}

export function getCachedGeocode(key: string): {
  lat: number;
  lng: number;
  provider: string;
  displayName?: string;
} | null {
  const row = cacheStmts.get.get(key) as CacheEntry | undefined;
  if (!row) return null;

  if (row.success && row.lat != null && row.lng != null) {
    return {
      lat: row.lat,
      lng: row.lng,
      provider: row.provider || "Nominatim",
      displayName: row.displayName ?? undefined,
    };
  }

  if (!row.success) {
    const ageMs = Date.now() - new Date(row.createdAt + "Z").getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < FAILURE_TTL_DAYS) {
      return null;
    }
  }

  return null;
}

export function isRecentFailure(key: string): boolean {
  const row = cacheStmts.get.get(key) as CacheEntry | undefined;
  if (!row || row.success) return false;
  const ageMs = Date.now() - new Date(row.createdAt + "Z").getTime();
  return ageMs / (1000 * 60 * 60 * 24) < FAILURE_TTL_DAYS;
}

export function cacheGeocode(
  key: string,
  lat: number | null,
  lng: number | null,
  provider: string,
  success: boolean,
  displayName?: string,
): void {
  cacheStmts.upsert.run(
    key,
    lat,
    lng,
    provider,
    success ? 1 : 0,
    displayName ?? null,
  );
}
