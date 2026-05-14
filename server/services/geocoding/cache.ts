import { sqlite } from "../../db.ts";

export const FAILURE_TTL_DAYS = 7;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS geocode_cache (
    key       TEXT PRIMARY KEY,
    lat       REAL,
    lng       REAL,
    provider  TEXT NOT NULL,
    success   INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);

const cacheStmts = {
  get: sqlite.prepare(
    `SELECT lat, lng, success, createdAt FROM geocode_cache WHERE key = ?`,
  ),
  upsert: sqlite.prepare(`
    INSERT INTO geocode_cache (key, lat, lng, provider, success)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
      provider = excluded.provider, success = excluded.success, createdAt = CURRENT_TIMESTAMP
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
  success: number;
  createdAt: string;
}

export function getCachedGeocode(
  key: string,
): { lat: number; lng: number } | null {
  const row = cacheStmts.get.get(key) as CacheEntry | undefined;
  if (!row) return null;

  if (row.success && row.lat != null && row.lng != null) {
    return { lat: row.lat, lng: row.lng };
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
): void {
  cacheStmts.upsert.run(key, lat, lng, provider, success ? 1 : 0);
}
