/**
 * aiCache.ts — Unified AI Response Cache with Per-Operation LRU + TTL Tiers.
 *
 * This module is the single source of truth for ALL server-side caching of AI
 * responses. It replaces the former `searchCache.ts` and the bare
 * `cachedInsight` variable in `dashboardService.ts`.
 *
 * WHY THIS EXISTS:
 * Every Gemini API call costs quota (RPM/RPD/TPM). On the FREE tier, redundant
 * calls for identical inputs are pure waste. This cache intercepts repeated
 * requests and returns cached results in <0.1ms instead of 500ms–3s LLM calls.
 *
 * ARCHITECTURE:
 * - Each AI operation gets its own isolated tier (Map) with independent TTL,
 *   max-entry cap, and invalidation strategy.
 * - Operations never interfere: a flood of search queries can't evict briefings.
 * - Batch mode (Phase 4) defers invalidation during bulk operations, then
 *   consolidates into a single flush on exit.
 *
 * DIAGNOSTICS:
 * Every cache event (HIT, MISS, SET, EVICT, INVALIDATE, BATCH_DEFER,
 * BATCH_FLUSH) is logged at DEBUG level via the structured logger.
 * Cache stats (hit/miss counters per tier) are available via getStats().
 *
 * @module server/utils/aiCache
 */

import { log } from "./logger.ts";
import crypto from "crypto";

// =============================================================================
// Types
// =============================================================================

/** Configuration for a single cache operation tier. */
interface TierConfig {
  /** Time-to-live in milliseconds. Entries older than this are expired on access. */
  ttlMs: number;
  /** Maximum number of entries. LRU eviction when exceeded. */
  maxEntries: number;
  /** Human-readable label for log messages. */
  label: string;
}

/** A single cached entry within a tier. */
interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch ms
  lastAccessed: number; // epoch ms — for LRU ordering
  createdAt: number; // epoch ms — for diagnostics
}

/** Hit/miss statistics for a single tier. */
interface TierStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
}

// =============================================================================
// Tier Definitions
// =============================================================================
// Each AI operation has its own isolated cache tier with tuned TTL and capacity.
// The rationale for each TTL is documented inline.

const TIER_CONFIGS: Record<string, TierConfig> = {
  /**
   * Briefing: "Catch Me Up" executive briefings per contact.
   * TTL 24h: Increased from 30m to 24h. Caches will still be invalidated
   * automatically when the contact's interaction count changes.
   * Invalidation: Targeted per-contact (prefix match on contactId).
   */
  briefing: { ttlMs: 24 * 60 * 60_000, maxEntries: 100, label: "Briefing" },

  /**
   * Rerank: LLM reranking results for Ask Contrack search queries.
   * TTL 12h: Increased from 5m to 12h for longer persistence.
   * Invalidation: Full flush on any contact mutation.
   */
  rerank: { ttlMs: 12 * 60 * 60_000, maxEntries: 200, label: "Rerank" },

  /**
   * Synthesis: Executive brief from Ask Contrack search results.
   * TTL 12h: Increased from 10m to 12h for longer persistence.
   * Invalidation: Full flush on any contact mutation.
   */
  synthesis: { ttlMs: 12 * 60 * 60_000, maxEntries: 100, label: "Synthesis" },

  /**
   * Mentions: Named entity extraction from interaction text.
   * TTL 24h: Interaction text is immutable after save. Mention extraction is
   * deterministic per input text. The 24h TTL bounds memory growth (peer review
   * concern) while still providing near-permanent caching for the session.
   * Invalidation: Never (inputs are immutable).
   */
  mentions: { ttlMs: 24 * 60 * 60_000, maxEntries: 200, label: "Mentions" },

  /**
   * Daily Insight: AI-generated CRM network insight.
   * TTL 24h: Regenerated once per day. Single-slot cache (maxEntries: 1).
   * Invalidation: Full flush on any contact mutation.
   */
  dailyInsight: {
    ttlMs: 24 * 60 * 60_000,
    maxEntries: 1,
    label: "DailyInsight",
  },

  /**
   * Query Parse: Structured filters extracted from a natural-language
   * Ask Contrack query (location / company / industry / role / traits /
   * temporal). Pure function of the query text and a small static schema,
   * so the result is stable across contact mutations — long TTL is safe.
   * Invalidation: Never (independent of contact data).
   */
  queryParse: {
    ttlMs: 24 * 60 * 60_000,
    maxEntries: 500,
    label: "QueryParse",
  },

  /**
   * HyDE: Hypothetical-document expansion of a search query, used as the
   * input text to the local embedding model instead of the bare query.
   * Like queryParse, this is a pure function of the query — no need to
   * invalidate on contact mutation (the expansion describes the *kind* of
   * person, not any specific contact).
   * Invalidation: Never.
   */
  hyde: { ttlMs: 24 * 60 * 60_000, maxEntries: 500, label: "HyDE" },
};

// =============================================================================
// Cache State
// =============================================================================

/** Per-tier storage. Each tier is an isolated Map<cacheKey, CacheEntry>. */
const stores = new Map<string, Map<string, CacheEntry>>();

/** Per-tier hit/miss/eviction counters. */
const stats = new Map<string, TierStats>();

/** Initialize all tiers on module load. */
for (const [op, config] of Object.entries(TIER_CONFIGS)) {
  stores.set(op, new Map());
  stats.set(op, { entries: 0, hits: 0, misses: 0, evictions: 0 });
}

// Log initialization
const tierSummary = Object.entries(TIER_CONFIGS)
  .map(([op, c]) => `${op}(${formatMs(c.ttlMs)}/${c.maxEntries})`)
  .join(", ");
log.info(
  "AICache",
  `Initialized ${Object.keys(TIER_CONFIGS).length} tiers: ${tierSummary}`,
);

// =============================================================================
// Batch Mode (Phase 4)
// =============================================================================
// Ref-counted batch mode. While active, invalidation calls are deferred and
// recorded. On exit (refCount → 0), all pending invalidations are replayed
// as a single consolidated flush.

let batchRefCount = 0;
const pendingInvalidations = new Set<string>(); // "all" or "tier::keyPrefix"

// =============================================================================
// Internal Helpers
// =============================================================================

/** Format milliseconds into human-readable duration. */
function formatMs(ms: number): string {
  if (ms >= 24 * 60 * 60_000) return `${ms / (24 * 60 * 60_000)}d`;
  if (ms >= 60 * 60_000) return `${ms / (60 * 60_000)}h`;
  if (ms >= 60_000) return `${ms / 60_000}m`;
  return `${ms / 1000}s`;
}

/** Normalise a raw query string into a cache key (same as former searchCache). */
function normalizeKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Evict the single least-recently-accessed entry from a tier. */
function evictLRU(tier: string, store: Map<string, CacheEntry>): void {
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
    const tierStats = stats.get(tier)!;
    tierStats.evictions++;
    tierStats.entries = store.size;
    log.debug(
      "AICache",
      `EVICT [${TIER_CONFIGS[tier]?.label}] "${oldestKey.slice(0, 40)}…" (LRU, ${store.size} remaining)`,
    );
  }
}

/** Remove expired entries from a tier (lazy cleanup on access). */
function removeExpired(tier: string, store: Map<string, CacheEntry>): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
  const tierStats = stats.get(tier)!;
  tierStats.entries = store.size;
}

// =============================================================================
// Public API — Core Operations
// =============================================================================

export const aiCache = {
  /**
   * Retrieve a cached value. Returns null on miss or expiry.
   * Refreshes lastAccessed for LRU ordering on hit.
   */
  get<T>(operation: string, key: string): T | null {
    const store = stores.get(operation);
    const tierStats = stats.get(operation);
    if (!store || !tierStats) {
      log.warn("AICache", `GET unknown operation: "${operation}"`);
      return null;
    }

    const entry = store.get(key);
    if (!entry) {
      tierStats.misses++;
      log.debug(
        "AICache",
        `MISS [${TIER_CONFIGS[operation]?.label}] "${key.slice(0, 50)}" (${store.size} entries)`,
      );
      return null;
    }

    // TTL check
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      tierStats.misses++;
      tierStats.entries = store.size;
      const age = Math.round((Date.now() - entry.createdAt) / 1000);
      log.debug(
        "AICache",
        `EXPIRED [${TIER_CONFIGS[operation]?.label}] "${key.slice(0, 50)}" (age: ${age}s)`,
      );
      return null;
    }

    // Cache hit — refresh LRU timestamp
    entry.lastAccessed = Date.now();
    tierStats.hits++;
    const ageMs = Date.now() - entry.createdAt;
    log.debug(
      "AICache",
      `HIT [${TIER_CONFIGS[operation]?.label}] "${key.slice(0, 50)}" (age: ${Math.round(ageMs / 1000)}s, ${store.size} entries)`,
    );
    return entry.value as T;
  },

  /**
   * Store a value. Enforces maxEntries via LRU eviction.
   */
  set<T>(operation: string, key: string, value: T): void {
    const store = stores.get(operation);
    const config = TIER_CONFIGS[operation];
    const tierStats = stats.get(operation);
    if (!store || !config || !tierStats) {
      log.warn("AICache", `SET unknown operation: "${operation}"`);
      return;
    }

    // Evict LRU if at capacity (and this is a new key)
    if (store.size >= config.maxEntries && !store.has(key)) {
      evictLRU(operation, store);
    }

    const now = Date.now();
    store.set(key, {
      value,
      expiresAt: now + config.ttlMs,
      lastAccessed: now,
      createdAt: now,
    });
    tierStats.entries = store.size;
    log.debug(
      "AICache",
      `SET [${config.label}] "${key.slice(0, 50)}" (TTL: ${formatMs(config.ttlMs)}, ${store.size} entries)`,
    );
  },

  /**
   * Invalidate cached entries.
   * - If `keyPrefix` is provided: remove all entries in the tier whose key
   *   starts with `keyPrefix`. Used for targeted per-contact invalidation.
   * - If `keyPrefix` is omitted: flush all entries in the tier.
   */
  invalidate(operation: string, keyPrefix?: string): void {
    // Batch mode: defer invalidation
    if (batchRefCount > 0) {
      const deferKey = keyPrefix ? `${operation}::${keyPrefix}` : operation;
      pendingInvalidations.add(deferKey);
      log.debug(
        "AICache",
        `BATCH_DEFER [${TIER_CONFIGS[operation]?.label}] invalidation deferred (depth: ${batchRefCount})`,
      );
      return;
    }

    const store = stores.get(operation);
    const tierStats = stats.get(operation);
    if (!store || !tierStats) return;

    if (keyPrefix) {
      // Targeted: remove entries with matching prefix
      let removed = 0;
      for (const key of store.keys()) {
        if (key.startsWith(keyPrefix)) {
          store.delete(key);
          removed++;
        }
      }
      tierStats.entries = store.size;
      if (removed > 0) {
        log.debug(
          "AICache",
          `INVALIDATE [${TIER_CONFIGS[operation]?.label}] ${removed} entries matching "${keyPrefix}*" (${store.size} remaining)`,
        );
      }
    } else {
      // Full flush of this tier
      const count = store.size;
      store.clear();
      tierStats.entries = 0;
      if (count > 0) {
        log.info(
          "AICache",
          `INVALIDATE [${TIER_CONFIGS[operation]?.label}] flushed ${count} entries`,
        );
      }
    }
  },

  /**
   * Nuclear option: flush ALL tiers. Used by contactService.invalidateAllCaches().
   * In batch mode, the flush is deferred until exitBatchMode().
   */
  invalidateAll(): void {
    if (batchRefCount > 0) {
      pendingInvalidations.add("__all__");
      log.debug(
        "AICache",
        `BATCH_DEFER invalidateAll deferred (depth: ${batchRefCount})`,
      );
      return;
    }

    let totalFlushed = 0;
    for (const [op, store] of stores) {
      totalFlushed += store.size;
      store.clear();
      const tierStats = stats.get(op)!;
      tierStats.entries = 0;
    }
    if (totalFlushed > 0) {
      log.info(
        "AICache",
        `INVALIDATE_ALL flushed ${totalFlushed} entries across ${stores.size} tiers`,
      );
    }
  },

  // ===========================================================================
  // Batch Mode (Phase 4)
  // ===========================================================================

  /**
   * Enter batch mode. Invalidation calls are deferred until exitBatchMode().
   * Supports nesting (ref-counted).
   */
  enterBatchMode(): void {
    batchRefCount++;
    log.info("AICache", `BATCH_ENTER (depth: ${batchRefCount})`);
  },

  /**
   * Exit batch mode. When the ref count reaches 0, replay all pending
   * invalidations as a single consolidated flush.
   */
  exitBatchMode(): void {
    if (batchRefCount <= 0) {
      log.warn("AICache", "BATCH_EXIT called with no active batch — ignoring");
      return;
    }

    batchRefCount--;
    log.info(
      "AICache",
      `BATCH_EXIT (depth: ${batchRefCount}, pending: ${pendingInvalidations.size})`,
    );

    if (batchRefCount === 0 && pendingInvalidations.size > 0) {
      log.info(
        "AICache",
        `BATCH_FLUSH replaying ${pendingInvalidations.size} deferred invalidation(s)`,
      );

      // If "all" was requested, just do a full flush
      if (pendingInvalidations.has("__all__")) {
        // Temporarily clear pending so invalidateAll doesn't re-defer
        pendingInvalidations.clear();
        aiCache.invalidateAll();
        return;
      }

      // Otherwise, replay each targeted invalidation
      const pending = [...pendingInvalidations];
      pendingInvalidations.clear();
      for (const entry of pending) {
        const sepIdx = entry.indexOf("::");
        if (sepIdx === -1) {
          // Tier-level flush: "rerank"
          aiCache.invalidate(entry);
        } else {
          // Targeted flush: "briefing::contactId123"
          const op = entry.slice(0, sepIdx);
          const prefix = entry.slice(sepIdx + 2);
          aiCache.invalidate(op, prefix);
        }
      }
    }
  },

  /**
   * Emergency escape hatch: reset batch mode and flush everything.
   * Use this if a batch operation crashes mid-way and exits without
   * calling exitBatchMode().
   */
  forceClearBatchMode(): void {
    if (batchRefCount > 0) {
      log.warn(
        "AICache",
        `BATCH_FORCE_CLEAR resetting depth from ${batchRefCount} to 0`,
      );
      batchRefCount = 0;
      pendingInvalidations.clear();
      aiCache.invalidateAll();
    }
  },

  // ===========================================================================
  // Diagnostics
  // ===========================================================================

  /**
   * Get hit/miss/entry statistics for all tiers.
   *
   * The returned record maps tier names to their stats, plus one special
   * "batchMode" key with batch-mode metadata — consumers iterate entries and
   * skip "batchMode" (see aiStatsService). The union return type reflects
   * that runtime shape honestly; the old intersection type was
   * unconstructable and needed an `as any`.
   */
  getStats(): Record<
    string,
    | (TierStats & { ttlMs: number; maxEntries: number })
    | { active: boolean; depth: number; pendingInvalidations: number }
  > {
    const result: Record<
      string,
      TierStats & { ttlMs: number; maxEntries: number }
    > = {};
    for (const [op, tierStats] of stats) {
      // Clean expired before reporting
      removeExpired(op, stores.get(op)!);
      result[op] = {
        ...tierStats,
        entries: stores.get(op)!.size,
        ttlMs: TIER_CONFIGS[op]?.ttlMs,
        maxEntries: TIER_CONFIGS[op]?.maxEntries,
      };
    }
    return {
      ...result,
      batchMode: {
        active: batchRefCount > 0,
        depth: batchRefCount,
        pendingInvalidations: pendingInvalidations.size,
      },
    };
  },
};

// =============================================================================
// Backward-Compat API (replaces searchCache.ts)
// =============================================================================
// These functions mirror the former searchCache.ts public API exactly, so
// existing consumers (searchService.ts, mergeEngine.ts) can switch imports
// without any code changes.

export interface CachedSearchResult {
  matches: unknown[];
  fallback: boolean;
}

/**
 * Return a cached search result, or null on cache-miss / expiry.
 * Drop-in replacement for the former searchCache.getCachedSearch().
 */
export function getCachedSearch(query: string): CachedSearchResult | null {
  const key = normalizeKey(query);
  return aiCache.get<CachedSearchResult>("rerank", key);
}

/**
 * Store a search result. Drop-in replacement for searchCache.setCachedSearch().
 */
export function setCachedSearch(
  query: string,
  value: CachedSearchResult,
): void {
  const key = normalizeKey(query);
  aiCache.set("rerank", key, value);
}

/**
 * Invalidate all cached search results.
 * Drop-in replacement for searchCache.invalidateSearchCache().
 */
export function invalidateSearchCache(): void {
  aiCache.invalidate("rerank");
}

/** Diagnostic: number of live (non-expired) search cache entries. */
export function searchCacheSize(): number {
  const store = stores.get("rerank");
  if (!store) return 0;
  removeExpired("rerank", store);
  return store.size;
}

// =============================================================================
// Utility: Content-addressed hashing for mention extraction cache
// =============================================================================

/**
 * Generate a short content hash for mention extraction caching.
 * Uses the first 16 chars of SHA-256 — collision probability is negligible
 * for the expected mention cache size (~200 entries).
 */
export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}
