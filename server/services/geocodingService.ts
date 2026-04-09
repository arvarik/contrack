/**
 * GeocodingService — Location → lat/lng resolution with persistent caching.
 *
 * Design principles:
 * - Each unique location string is geocoded at most ONCE via external API.
 * - Results (including failures) are cached in a `geocode_cache` SQLite table.
 * - Failed lookups are retried after FAILURE_TTL_DAYS to handle transient errors.
 * - The queue is deduplicated by normalized location key to prevent redundant work.
 * - All callers go through queueGeocode(); the cache is transparent.
 *
 * Supported providers:
 * - Mapbox (if MAPBOX_API_KEY env var is set) — 100K req/month free tier
 * - Nominatim/OSM (fallback) — max 1 req/sec, single-threaded
 *
 * Cache key normalization:
 * - "San Francisco, CA" / "san francisco,  CA" / " SAN FRANCISCO, CA " → same key
 * - Allows natural address edits to bust the cache (different text = cache miss)
 */
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../utils/logger.ts";

// =============================================================================
// Constants
// =============================================================================

const FAILURE_TTL_DAYS = 7;          // Retry failed geocodes after this many days
const INTER_REQUEST_DELAY_MS = 1100; // Rate limit: 1 req/sec for Nominatim
const STARTUP_DELAY_MS = 2000;       // Delay before retroactive geocoding

// =============================================================================
// Cache Table (raw DDL — infrastructure concern, not domain model)
// =============================================================================

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

// Pre-compiled prepared statements for cache operations
const cacheStmts = {
  get: sqlite.prepare(`SELECT lat, lng, success, createdAt FROM geocode_cache WHERE key = ?`),
  upsert: sqlite.prepare(`
    INSERT INTO geocode_cache (key, lat, lng, provider, success)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
      provider = excluded.provider, success = excluded.success, createdAt = CURRENT_TIMESTAMP
  `),
};

// =============================================================================
// Cache Key Normalization
// =============================================================================
// Ensures that minor formatting differences don't cause cache misses.
// "San Francisco, CA" and "san francisco,  CA" map to the same key.
// Actual content changes (typo fixes, different address) correctly produce
// a different key, triggering a fresh geocode.
// =============================================================================

function normalizeLocationKey(location: string): string {
  return location
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')          // collapse multiple spaces
    .replace(/\s*,\s*/g, ', ')     // normalize comma spacing: "a ,b" → "a, b"
    .replace(/^,+|,+$/g, '');      // strip leading/trailing commas
}

// =============================================================================
// Cache Lookup
// =============================================================================
// Returns { lat, lng } if a valid cache entry exists, null otherwise.
// A "valid" entry is either a successful geocode (never expires) or a failed
// geocode that hasn't exceeded FAILURE_TTL_DAYS (to allow retries).
// =============================================================================

interface CacheEntry {
  lat: number | null;
  lng: number | null;
  success: number;
  createdAt: string;
}

function getCachedGeocode(key: string): { lat: number; lng: number } | null {
  const row = cacheStmts.get.get(key) as CacheEntry | undefined;
  if (!row) return null;

  // Successful geocodes never expire
  if (row.success && row.lat != null && row.lng != null) {
    return { lat: row.lat, lng: row.lng };
  }

  // Failed geocodes expire after FAILURE_TTL_DAYS to allow retries
  if (!row.success) {
    const ageMs = Date.now() - new Date(row.createdAt + 'Z').getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < FAILURE_TTL_DAYS) {
      return null; // Still within TTL — treat as "known failure, don't retry"
    }
    // TTL expired — fall through to return null (will trigger a fresh geocode)
  }

  return null;
}

// Edge case: for failed lookups still within TTL, we return a sentinel to
// distinguish "not cached" from "cached as failure". This prevents the queue
// from making redundant API calls for known-bad addresses.
function isRecentFailure(key: string): boolean {
  const row = cacheStmts.get.get(key) as CacheEntry | undefined;
  if (!row || row.success) return false;
  const ageMs = Date.now() - new Date(row.createdAt + 'Z').getTime();
  return ageMs / (1000 * 60 * 60 * 24) < FAILURE_TTL_DAYS;
}

function cacheGeocode(key: string, lat: number | null, lng: number | null, provider: string, success: boolean): void {
  cacheStmts.upsert.run(key, lat, lng, provider, success ? 1 : 0);
}

// =============================================================================
// Geocode Queue
// =============================================================================

interface GeoTask {
  contactId: string;
  location: string;
  normalizedKey: string;
}

const geocodeQueue: GeoTask[] = [];
let isGeocoding = false;

/**
 * Queue a contact for geocoding. Guards against redundant work:
 * 1. Empty/null location strings are ignored.
 * 2. Cache hits are applied immediately without queueing.
 * 3. Known recent failures within TTL are skipped.
 * 4. Duplicate queue entries for the same normalized key are collapsed.
 */
export function queueGeocode(contactId: string, location: string): void {
  if (!location?.trim()) return;

  const key = normalizeLocationKey(location);

  // Guard 1: Cache hit — apply immediately, no API call
  const cached = getCachedGeocode(key);
  if (cached) {
    db.update(schema.contacts)
      .set({ lat: cached.lat, lng: cached.lng })
      .where(eq(schema.contacts.id, contactId))
      .run();
    log.debug("Geocode", `Cache hit for "${location}" → ${cached.lat}, ${cached.lng}`);
    return;
  }

  // Guard 2: Known recent failure — skip silently
  if (isRecentFailure(key)) {
    log.debug("Geocode", `Skipping "${location}" — cached failure, retry in <${FAILURE_TTL_DAYS}d`);
    return;
  }

  // Guard 3: Deduplicate — don't queue the same normalized key twice
  // (but DO add the contactId so all contacts with the same location get updated)
  const existing = geocodeQueue.find(t => t.normalizedKey === key);
  if (existing) {
    // Already queued — just make sure this contactId also gets updated when the geocode completes.
    // We handle this by allowing multiple entries for different contactIds with the same key.
    if (existing.contactId !== contactId) {
      geocodeQueue.push({ contactId, location, normalizedKey: key });
    }
    return;
  }

  geocodeQueue.push({ contactId, location, normalizedKey: key });
  processGeocodeQueue();
}

// =============================================================================
// Queue Processor
// =============================================================================

async function processGeocodeQueue(): Promise<void> {
  if (isGeocoding || geocodeQueue.length === 0) return;
  isGeocoding = true;

  while (geocodeQueue.length > 0) {
    const task = geocodeQueue.shift()!;

    // Double-check cache (another queue item for the same key may have populated it)
    const cached = getCachedGeocode(task.normalizedKey);
    if (cached) {
      applyCoordinates(task.contactId, task.normalizedKey, cached.lat, cached.lng);
      continue;
    }

    // Perform the actual geocode with progressive fallback
    const result = await geocodeWithFallback(task.location);

    if (result) {
      cacheGeocode(task.normalizedKey, result.lat, result.lng, result.provider, true);
      applyCoordinates(task.contactId, task.normalizedKey, result.lat, result.lng);
      log.info("Geocode", `[${result.provider}] "${task.location}" → ${result.lat}, ${result.lng}`);
    } else {
      cacheGeocode(task.normalizedKey, null, null, "none", false);
      log.warn("Geocode", `No results for "${task.location}" — cached as failure for ${FAILURE_TTL_DAYS}d`);
    }

    await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
  }

  isGeocoding = false;
}

/**
 * Apply coordinates to a contact AND any other queued contacts waiting for the
 * same normalized key. This handles the case where 50 contacts all have
 * "San Francisco, CA" — geocode once, apply to all.
 */
function applyCoordinates(contactId: string, normalizedKey: string, lat: number, lng: number): void {
  // Apply to the primary contact
  db.update(schema.contacts)
    .set({ lat, lng })
    .where(eq(schema.contacts.id, contactId))
    .run();

  // Apply to any remaining queue items with the same key (bulk import scenario)
  const dupes = geocodeQueue.filter(t => t.normalizedKey === normalizedKey);
  for (const dupe of dupes) {
    db.update(schema.contacts)
      .set({ lat, lng })
      .where(eq(schema.contacts.id, dupe.contactId))
      .run();
  }
  // Remove the applied duplicates from the queue
  const remaining = geocodeQueue.filter(t => t.normalizedKey !== normalizedKey);
  geocodeQueue.length = 0;
  geocodeQueue.push(...remaining);
}

// =============================================================================
// External API Call with Progressive Fallback
// =============================================================================
// Tries the full location string first, then progressively drops the first
// comma-separated segment to broaden the match (e.g., "Unit 5, 123 Main St,
// Springfield, IL" → "123 Main St, Springfield, IL" → "Springfield, IL").
// =============================================================================

interface GeoResult {
  lat: number;
  lng: number;
  provider: string;
}

async function geocodeWithFallback(location: string): Promise<GeoResult | null> {
  let searchStr = location;
  const mapboxKey = process.env.MAPBOX_API_KEY;
  const provider = mapboxKey ? "Mapbox" : "Nominatim";

  for (let fallback = 0; fallback < 4 && searchStr.length > 0; fallback++) {
    try {
      const result = await geocodeSingle(searchStr, mapboxKey);
      if (result) return { ...result, provider };

      // No result — broaden by dropping the first segment
      const parts = searchStr.split(',');
      if (parts.length <= 1) break;
      searchStr = parts.slice(1).join(',').trim();

      if (fallback < 3) {
        await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    } catch (err: any) {
      log.error("Geocode", `API error for "${searchStr}": ${err.message}`);
      break; // Don't retry on network/API errors — let the failure cache handle it
    }
  }

  return null;
}

async function geocodeSingle(query: string, mapboxKey?: string): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  try {
    if (mapboxKey) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxKey}&limit=1`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        log.warn("Geocode", `Mapbox returned HTTP ${res.status} for "${query}"`);
        return null;
      }
      const data = await res.json();
      if (data?.features?.[0]) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }
    } else {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ContrackCRM/1.0 (personal-crm; geocoder; +https://github.com/contrack)",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!res.ok) {
        log.warn("Geocode", `Nominatim returned HTTP ${res.status} for "${query}"`);
        return null;
      }
      const data = await res.json();
      if (data?.[0]) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

// =============================================================================
// Startup Retroactive Geocoding
// =============================================================================
// On server start, queue contacts that have a location/address but no coordinates.
// The cache prevents redundant API calls for previously geocoded strings.
// =============================================================================

export function startRetroactiveGeocoding(): void {
  setTimeout(() => {
    const ungeocoded = sqlite.prepare(
      "SELECT id, location FROM contacts WHERE location IS NOT NULL AND location != '' AND (lat IS NULL OR lng IS NULL)"
    ).all() as { id: string; location: string }[];

    if (ungeocoded.length > 0) {
      log.info("Geocode", `Queuing ${ungeocoded.length} contact(s) for startup geocoding (cache will deduplicate)`);
      for (const c of ungeocoded) {
        queueGeocode(c.id, c.location);
      }
    }
  }, STARTUP_DELAY_MS);
}
