/**
 * Lightweight LRU cache for semantic search results.
 *
 * Cache key   : normalised query string (trimmed + lowercased)
 * TTL         : 5 minutes — short enough that freshly-edited contacts
 *               don't stay invisible, long enough to skip Gemini for
 *               repeated or similar queries in the same session.
 * Max entries : 100 (LRU eviction — oldest-accessed entry is dropped)
 *
 * The cache is intentionally in-process only (no Redis / SQLite backing).
 * It survives across requests but resets on server restart, which is fine
 * for a single-user local app.
 *
 * Call invalidateSearchCache() any time contact data is mutated so that
 * stale ranked results don't persist.
 */

import { log } from "./logger.ts";

export interface CachedSearchResult {
  matches: any[];
  fallback: boolean;
}

interface CacheEntry {
  value: CachedSearchResult;
  expiresAt: number;   // epoch ms
  lastAccessed: number; // epoch ms — for LRU
}

const TTL_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_ENTRIES = 100;

const store = new Map<string, CacheEntry>();

/** Normalise a raw query string into a cache key. */
function normaliseKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Evict the single least-recently-accessed entry (true LRU). */
function evictLRU(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of store) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    store.delete(oldestKey);
    log.debug("SearchCache", `LRU eviction: "${oldestKey.slice(0, 40)}…"`);
  }
}

/** Return a cached result, or null on cache-miss / expiry. */
export function getCachedSearch(query: string): CachedSearchResult | null {
  const key = normaliseKey(query);
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    log.debug("SearchCache", `TTL expired: "${key.slice(0, 40)}"`);
    return null;
  }

  // Refresh last-accessed for LRU ordering
  entry.lastAccessed = Date.now();
  log.debug("SearchCache", `HIT (${store.size} entries): "${key.slice(0, 60)}"`);
  return entry.value;
}

/** Store a result. Automatically enforces MAX_ENTRIES via LRU eviction. */
export function setCachedSearch(query: string, value: CachedSearchResult): void {
  const key = normaliseKey(query);
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    evictLRU();
  }
  const now = Date.now();
  store.set(key, {
    value,
    expiresAt: now + TTL_MS,
    lastAccessed: now,
  });
  log.debug("SearchCache", `SET (${store.size} entries): "${key.slice(0, 60)}"`);
}

/**
 * Invalidate all cached results.
 * Call this whenever contact data is mutated (create, update, delete, archive).
 * The next semantic query will re-hit Gemini with fresh contact data.
 */
export function invalidateSearchCache(): void {
  const count = store.size;
  store.clear();
  if (count > 0) {
    log.info("SearchCache", `Invalidated ${count} cached search result(s)`);
  }
}

/** Diagnostic: number of live (non-expired) cache entries. */
export function searchCacheSize(): number {
  const now = Date.now();
  let live = 0;
  for (const entry of store.values()) {
    if (entry.expiresAt > now) live++;
  }
  return live;
}
