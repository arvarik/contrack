/**
 * searchCache.ts — DEPRECATED: Thin re-export shim for backward compatibility.
 *
 * All caching logic has been unified into `aiCache.ts` (Phase 2 — Caching Strategy).
 * This file re-exports the identical public API so existing consumers don't need
 * to change their imports immediately.
 *
 * NEW CODE SHOULD IMPORT FROM `aiCache.ts` DIRECTLY.
 *
 * @deprecated Use `import { getCachedSearch, ... } from "./aiCache.ts"` instead.
 * @module server/utils/searchCache
 */

export {
  getCachedSearch,
  setCachedSearch,
  invalidateSearchCache,
  searchCacheSize,
  type CachedSearchResult,
} from "./aiCache.ts";
