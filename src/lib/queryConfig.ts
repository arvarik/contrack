/**
 * queryConfig.ts — Centralized React Query cache configuration.
 *
 * WHY THIS FILE EXISTS:
 * Caching bugs are notoriously hard to debug because stale data looks correct
 * until it doesn't. This module centralizes all staleTime values in one place
 * so they can be audited at a glance, and provides a diagnostic logger that
 * reports cache hit/miss/stale decisions to the browser console.
 *
 * HOW TO USE:
 * 1. Import `STALE_TIMES` and apply to `useQuery({ staleTime: STALE_TIMES.contactDetail })`
 * 2. Import `logCacheEvent` for manual diagnostics in development
 *
 * RULES:
 * - The global default (30s) is set in `main.tsx`. Only ADD overrides here
 *   for queries that need longer freshness windows.
 * - All mutations already call `invalidateQueries()` which bypasses staleTime.
 *   staleTime only controls *passive* refetches (component mounts, focus, etc).
 * - If you add a new query hook, check if it needs a custom staleTime here.
 *
 * @module lib/queryConfig
 */

// =============================================================================
// Stale Time Constants
// =============================================================================
// Each value is in milliseconds. The comment explains *why* that specific
// duration was chosen — not just what it does. This makes it auditable.
//
// Global default (from main.tsx):  30_000 (30 seconds)
// =============================================================================

export const STALE_TIMES = {
  /**
   * Individual contact detail page.
   * WHY 60s: Once viewing a contact, the data only changes when the user
   * themselves edits it (single-user app). 60s prevents refetching when
   * toggling between list ↔ detail ↔ list. Mutations invalidate immediately.
   */
  contactDetail: 60_000,

  /**
   * Map data (geocoded coordinates + markers).
   * WHY 5min: Geocoded lat/lng values change only when a contact's location
   * field is edited — extremely rare. 5 minutes is very conservative.
   */
  mapData: 5 * 60_000,

  /**
   * Contact lists (sidebar list panel).
   * WHY 60s: Lists change only on explicit create/reorder/delete, which
   * all fire invalidateQueries. 60s prevents list refetch on sidebar toggle.
   */
  lists: 60_000,

  /**
   * List member contacts (contacts within a specific list).
   * WHY 60s: Same rationale as lists — membership changes via explicit
   * add/remove mutations that invalidate immediately.
   */
  listContacts: 60_000,

  /**
   * Dashboard aggregate data (relationship pulse metrics).
   * WHY 2min: The dashboard aggregates 10+ SQL queries across all contacts.
   * These metrics (at-risk count, industry composition) change slowly.
   * 2 minutes prevents re-querying when navigating away and back.
   */
  dashboard: 2 * 60_000,

  /**
   * Timeline interactions for a specific contact.
   * WHY 30s: Timeline data changes when the user logs an interaction,
   * which triggers explicit invalidation. Between logs, 30s is safe.
   * Uses global default — listed here for documentation completeness.
   */
  timeline: 30_000,

  /**
   * Archived contacts list.
   * WHY 2min: Rarely accessed, changes only on explicit archive/unarchive.
   */
  archived: 2 * 60_000,
} as const;

// =============================================================================
// Cache Diagnostic Logger
// =============================================================================
// Opt-in logging for debugging cache behavior in development. When enabled,
// logs cache decisions (hit/miss/stale/invalidate) to the browser console
// with structured metadata.
//
// Enable in browser console: window.__CONTRACK_CACHE_DEBUG = true
// =============================================================================

type CacheEventType =
  | "hit"
  | "miss"
  | "stale"
  | "invalidate"
  | "prefetch"
  | "placeholder";

interface CacheEvent {
  type: CacheEventType;
  queryKey: string;
  meta?: Record<string, unknown>;
}

// Color coding for each event type — makes console output scannable
const EVENT_COLORS: Record<CacheEventType, string> = {
  hit: "color: #10b981; font-weight: bold", // green
  miss: "color: #ef4444; font-weight: bold", // red
  stale: "color: #f59e0b; font-weight: bold", // amber
  invalidate: "color: #8b5cf6; font-weight: bold", // purple
  prefetch: "color: #3b82f6; font-weight: bold", // blue
  placeholder: "color: #6b7280; font-weight: bold", // gray
};

/**
 * Log a cache diagnostic event to the browser console.
 * Only fires when `window.__CONTRACK_CACHE_DEBUG` is truthy.
 *
 * @example
 * logCacheEvent({ type: 'hit', queryKey: "['contacts']", meta: { age: '12s' } });
 */
export function logCacheEvent(event: CacheEvent): void {
  if (typeof window === "undefined") return;
  if (!(window as unknown as Record<string, unknown>).__CONTRACK_CACHE_DEBUG)
    return;

  const style = EVENT_COLORS[event.type];
  const metaStr = event.meta ? ` ${JSON.stringify(event.meta)}` : "";
  console.log(
    `%c[Cache:${event.type.toUpperCase()}]%c ${event.queryKey}${metaStr}`,
    style,
    "color: inherit",
  );
}

// =============================================================================
// Type augmentation: allow the debug flag on window
// =============================================================================

declare global {
  interface Window {
    __CONTRACK_CACHE_DEBUG?: boolean;
  }
}
