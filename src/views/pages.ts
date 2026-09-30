/**
 * pages: the app's three lazy pages, and their warm-up.
 *
 * Map, Pulse and Ask Contrack are each their own chunk. A first visit to one
 * of them used to show its skeleton even when the chunk took 5 ms: a plain
 * `React.lazy` page suspends on its first render, and React then holds a
 * new fallback on screen for 300 ms (its fallback throttle). Pulse then
 * drew a second skeleton, its own, because its data was asked for only once
 * its page had mounted. That skeleton, then skeleton, then page was the
 * flicker on a first switch.
 *
 * 1. Each page is a `preloadable` (`lib/preloadable`): once its code is here
 *    it renders at once, with no Suspense on the way.
 * 2. The app loads the code of all three in idle moments, one page per idle
 *    moment, the map first because it is the largest (`useWarmPages`). A
 *    browser told to save data is left alone (`lib/idle`).
 * 3. A link to a page warms it when a person points at, focuses or presses
 *    it (`usePageLinkWarm`): its code, and for Pulse its first data.
 *
 * The code of a page that is still on its way suspends inside the app's one
 * page boundary (`App.tsx`), and a navigation is a transition, so the page
 * on screen stays until the new one can draw.
 *
 * @module views/pages
 */
import { useContext, useMemo, useEffect } from "react";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";
import { prefetchPulse } from "../api/dashboard";
import { whenIdle } from "../lib/idle";
import { preloadable, type Preloadable } from "../lib/preloadable";

export const mapPage = preloadable(() =>
  import("./map").then((m) => ({ default: m.MapView })),
);

export const pulsePage = preloadable(() =>
  import("./pulse").then((m) => ({ default: m.PulseView })),
);

export const askPage = preloadable(() =>
  import("./SearchView").then((m) => ({ default: m.SearchView })),
);

/** The idle warm-up's order: the largest chunk first. */
const WARM_ORDER: readonly Preloadable<object>[] = [
  mapPage,
  pulsePage,
  askPage,
];

/** The lazy page at `path`, or null for a page in the entry bundle. */
export function pageAt(path: string): Preloadable<object> | null {
  if (path.startsWith("/map")) return mapPage;
  if (path.startsWith("/pulse")) return pulsePage;
  if (path.startsWith("/search")) return askPage;
  return null;
}

/**
 * Loads the code of the page at `path` and, with a query client, starts the
 * first data of a page that has some to start. A failed download is left
 * for the page's own load to report.
 */
export function warmPage(path: string, queryClient?: QueryClient | null): void {
  pageAt(path)
    ?.load()
    .catch(() => undefined);
  if (queryClient && path.startsWith("/pulse")) prefetchPulse(queryClient);
}

/**
 * Loads each page's code in turn, one page per idle moment. Returns a
 * function that stops the rest.
 */
export function warmPages(
  pages: readonly Preloadable<object>[] = WARM_ORDER,
): () => void {
  let stopped = false;
  let cancelIdle = () => {};
  const next = (index: number) => {
    if (stopped || index >= pages.length) return;
    cancelIdle = whenIdle(() => {
      pages[index]
        .load()
        .catch(() => undefined)
        .finally(() => next(index + 1));
    });
  };
  next(0);
  return () => {
    stopped = true;
    cancelIdle();
  };
}

/** The app's warm-up: the code of every lazy page, in idle moments. */
export function useWarmPages(): void {
  useEffect(() => warmPages(), []);
}

/** The handlers a link to a page spreads to warm that page. */
export function pageLinkWarm(to: string, queryClient?: QueryClient | null) {
  const warm = () => warmPage(to, queryClient);
  return { onPointerEnter: warm, onFocus: warm, onPointerDown: warm };
}

/**
 * `pageLinkWarm` for one link. The query client is read from context, not
 * required: without one, only the code is warmed.
 */
export function usePageLinkWarm(to: string) {
  const queryClient = useContext(QueryClientContext);
  return useMemo(() => pageLinkWarm(to, queryClient), [to, queryClient]);
}
