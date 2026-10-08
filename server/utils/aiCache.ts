/**
 * The server's cache of AI responses: one LRU tier per operation, each with its
 * own TTL, size cap and invalidation, so a flood of searches cannot evict
 * briefings. Every call it saves is provider quota and 0.5 to 3 s of waiting.
 * Batch mode defers invalidation during bulk writes and replays it as one
 * flush. Every cache event is logged at DEBUG, and getStats() has the counters.
 *
 * @module server/utils/aiCache
 */

import { log } from "./logger.ts";
import crypto from "crypto";
import type { Scope } from "../tenancy/scope.ts";

// Types

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

// Tiers, with the reason for each TTL inline.

const TIER_CONFIGS: Record<string, TierConfig> = {
  /**
   * Briefing: "Catch Me Up" per contact. TTL 24 h. Invalidation: the contact's
   * entry when its notes change, and the owner's entries on any change to their
   * contacts.
   */
  briefing: { ttlMs: 24 * 60 * 60_000, maxEntries: 100, label: "Briefing" },

  /**
   * Rerank: reranked Ask Contrack results. TTL 12 h. Invalidation: the owner's
   * entries, on any change to their contacts. The key leads with the owner id
   * (`ownerKey`), because the value lists that owner's contacts.
   */
  rerank: { ttlMs: 12 * 60 * 60_000, maxEntries: 200, label: "Rerank" },

  /**
   * Synthesis: the brief over Ask Contrack results. TTL 12 h. Owner-keyed and
   * invalidated like `rerank`: the text names contacts.
   */
  synthesis: { ttlMs: 12 * 60 * 60_000, maxEntries: 100, label: "Synthesis" },

  /**
   * Mentions: names extracted from a note. TTL 24 h, which bounds memory: the
   * answer is a pure function of the note text, which does not change.
   * Invalidation: never. Shared across owners: the key is a hash of the text,
   * so two owners share an entry only when they wrote the same words, which
   * saves a paid call and tells neither anything about the other.
   */
  mentions: { ttlMs: 24 * 60 * 60_000, maxEntries: 200, label: "Mentions" },

  /**
   * Daily Insight: the dashboard's network insight, regenerated once a day.
   * Owner-keyed, one entry per owner, so one owner's first dashboard of the day
   * does not evict another's.
   */
  dailyInsight: {
    ttlMs: 24 * 60 * 60_000,
    maxEntries: 100,
    label: "DailyInsight",
  },

  /**
   * Query Parse: structured filters from an Ask Contrack question. A pure
   * function of the question and a fixed schema, so contact edits do not stale
   * it. Invalidation: never.
   */
  queryParse: {
    ttlMs: 24 * 60 * 60_000,
    maxEntries: 500,
    label: "QueryParse",
  },
};

// State

/** Per-tier storage. Each tier is an isolated Map<cacheKey, CacheEntry>. */
const stores = new Map<string, Map<string, CacheEntry>>();

/**
 * Caches outside the tiers that must empty with them. The semantic cache
 * (`services/search/semanticCache.ts`) finds Ask answers by question vector, so
 * it cannot be a keyed tier, but a flush of every tier must reach it.
 */
const flushAllListeners = new Set<() => void>();

/** Per-tier hit/miss/eviction counters. */
const stats = new Map<string, TierStats>();

/** Initialize all tiers on module load. */
for (const op of Object.keys(TIER_CONFIGS)) {
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

// Batch mode, ref-counted. While active, invalidations are recorded, and the
// last exit replays them as one flush.

let batchRefCount = 0;
const pendingInvalidations = new Set<string>(); // "all" or "tier::keyPrefix"

// Helpers

/** Format milliseconds into human-readable duration. */
function formatMs(ms: number): string {
  if (ms >= 24 * 60 * 60_000) return `${ms / (24 * 60 * 60_000)}d`;
  if (ms >= 60 * 60_000) return `${ms / (60 * 60_000)}h`;
  if (ms >= 60_000) return `${ms / 60_000}m`;
  return `${ms / 1000}s`;
}

/** Normalize a raw query string into a cache key. */
export function normalizeKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The cache key for one owner, used by every tier whose value describes
 * contacts: `rerank`, `synthesis`, `briefing` and `dailyInsight`. The owner is
 * a prefix, so prefix invalidation drops one owner's entries. `queryParse` and
 * `mentions` do not use it: their values name no contact.
 */
export function ownerKey(scope: Scope, key: string): string {
  return `${scope.ownerId}::${key}`;
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
      `EVICT [${TIER_CONFIGS[tier]?.label}] (LRU, ${store.size} remaining)`,
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

// Public API

export const aiCache = {
  /**
   * A cached value, or null on a miss or expiry. A hit refreshes its LRU place.
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
        `MISS [${TIER_CONFIGS[operation]?.label}] (${store.size} entries)`,
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
        `EXPIRED [${TIER_CONFIGS[operation]?.label}] (age: ${age}s)`,
      );
      return null;
    }

    // Cache hit — refresh LRU timestamp
    entry.lastAccessed = Date.now();
    tierStats.hits++;
    const ageMs = Date.now() - entry.createdAt;
    log.debug(
      "AICache",
      `HIT [${TIER_CONFIGS[operation]?.label}] (age: ${Math.round(ageMs / 1000)}s, ${store.size} entries)`,
    );
    return entry.value as T;
  },

  /** Store a value, evicting the least recently used past maxEntries. */
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
      `SET [${config.label}] (TTL: ${formatMs(config.ttlMs)}, ${store.size} entries)`,
    );
  },

  /**
   * Invalidate entries: those whose key starts with `keyPrefix`, or the whole
   * tier without one.
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
   * Drop one owner's entries from an owner-keyed tier, so one account's edit
   * does not cost every other account a paid regeneration. Not for `queryParse`
   * or `mentions`, whose keys hold no owner.
   */
  invalidateForOwner(operation: string, ownerId: string): void {
    aiCache.invalidate(operation, `${ownerId}::`);
  },

  /** Run `listener` whenever every tier is flushed, after the tiers empty. */
  onInvalidateAll(listener: () => void): void {
    flushAllListeners.add(listener);
  },

  /** Flush every tier, deferred to exitBatchMode() in batch mode. */
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
    for (const listener of flushAllListeners) listener();
    if (totalFlushed > 0) {
      log.info(
        "AICache",
        `INVALIDATE_ALL flushed ${totalFlushed} entries across ${stores.size} tiers`,
      );
    }
  },

  // Batch mode

  /** Enter batch mode: invalidations wait for exitBatchMode(). Nests. */
  enterBatchMode(): void {
    batchRefCount++;
    log.info("AICache", `BATCH_ENTER (depth: ${batchRefCount})`);
  },

  /**
   * Exit batch mode. At depth 0, replay the pending invalidations as one flush.
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

  // Diagnostics

  /**
   * Hit, miss and entry counts per tier, plus a "batchMode" key with the batch
   * state, which consumers skip (see aiStatsService).
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

// Search result cache, for searchService.ts and mergeEngine.ts.

export interface CachedSearchResult {
  matches: unknown[];
  fallback: boolean;
}

/**
 * A cached search result for this owner, or null on a miss or expiry. The value
 * lists hydrated contacts, so the key carries the owner.
 */
export function getCachedSearch(
  scope: Scope,
  query: string,
): CachedSearchResult | null {
  return aiCache.get<CachedSearchResult>(
    "rerank",
    ownerKey(scope, normalizeKey(query)),
  );
}

/** Store a search result under this owner's key. */
export function setCachedSearch(
  scope: Scope,
  query: string,
  value: CachedSearchResult,
): void {
  aiCache.set("rerank", ownerKey(scope, normalizeKey(query)), value);
}

/** Invalidate every cached search result. */
export function invalidateSearchCache(): void {
  aiCache.invalidate("rerank");
}

/**
 * A short content hash for the mention cache: 16 hex characters of SHA-256,
 * plenty for about 200 entries.
 */
export function contentHash(text: string): string {
  return crypto.hash("sha256", text).slice(0, 16);
}
