/**
 * React Query stale times in one place, and an opt-in cache logger. The
 * global default (30 s) is in `main.tsx`, and only longer windows belong
 * here. A mutation invalidates its queries, which ignores staleTime, so these
 * only govern passive refetches: a mount, a window focus.
 */

export const STALE_TIMES = {
  /** A contact's page. 60 s stops a refetch on every list and detail switch. */
  contactDetail: 60_000,

  /** Saved map views, which change only on a save, a rename or a delete. */
  mapViews: 60_000,

  /** Contact lists, which change only through mutations that invalidate them. */
  lists: 60_000,

  /** A list's members, for the same reason as `lists`. */
  listContacts: 60_000,

  /** Pulse's aggregates: many queries over every contact, and slow to change. */
  dashboard: 2 * 60_000,

  /** A contact's timeline, at the global default. Logging invalidates it. */
  timeline: 30_000,

  /** Archived contacts: rarely read, and changed only by an archive or a restore. */
  archived: 2 * 60_000,
} as const;

// The cache logger. Turn it on in the browser console with
// `window.__CONTRACK_CACHE_DEBUG = true`.

type CacheEventType = "prefetch";

interface CacheEvent {
  type: CacheEventType;
  queryKey: string;
  meta?: Record<string, unknown>;
}

const EVENT_COLORS: Record<CacheEventType, string> = {
  prefetch: "color: #3b82f6; font-weight: bold", // blue
};

/** Log a cache event to the console when `window.__CONTRACK_CACHE_DEBUG` is set. */
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

declare global {
  interface Window {
    __CONTRACK_CACHE_DEBUG?: boolean;
  }
}
