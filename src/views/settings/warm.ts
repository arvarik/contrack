/**
 * Loads settings pages before their link is pressed, so a page opens with
 * no "Loading…" and no rows that push its cards down.
 *
 * - Once Settings is on screen, the code of every visible page loads, one
 *   per idle moment, with its `prefetch` data (`useWarmSettingsPages`). A
 *   browser told to save data is left alone (`lib/idle`).
 * - Hover, focus or press on a link loads that page's code and `prefetch`
 *   data (`useWarmSettingsLink`). React Query keeps the result for the
 *   page's first render.
 *
 * `preloadable` renders a loaded page at once: a plain `React.lazy` page
 * suspends even then, and React holds it for 300 ms. Only visible pages are
 * warmed, so a member never asks for admin data.
 */
import { useContext, useEffect, useMemo } from "react";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "../../components/auth/AuthGate";
import { whenIdle } from "../../lib/idle";
import { preloadable, type Preloadable } from "../../lib/preloadable";
import {
  SETTINGS_PAGES,
  findSettingsPage,
  isSettingsPageVisible,
  type SettingsPage,
  type SettingsPageModule,
  type SettingsViewer,
} from "./registry";

/** Settings' shell, preloadable for the same 300 ms reason. */
export const settingsShell = preloadable(() =>
  import("./SettingsShell").then((m) => ({ default: m.SettingsShell })),
);

/** Starts Settings' shell, for a link to Settings a person points at. */
export function warmSettingsShell(): void {
  settingsShell.load().catch(() => undefined);
}

const pagePreloads = new Map<string, Preloadable<object, SettingsPageModule>>();

/** One cached preloadable per page. */
export function settingsPagePreload(
  page: SettingsPage,
): Preloadable<object, SettingsPageModule> {
  let preload = pagePreloads.get(page.id);
  if (!preload) {
    preload = preloadable<object, SettingsPageModule>(page.load);
    pagePreloads.set(page.id, preload);
  }
  return preload;
}

function visibleSettingsPages(viewer: SettingsViewer): SettingsPage[] {
  return SETTINGS_PAGES.filter((page) => isSettingsPageVisible(page, viewer));
}

/** A failure here is left for the page's own load to report. */
export function warmSettingsPage(
  page: SettingsPage | undefined,
  queryClient?: QueryClient,
): void {
  if (!page) return;
  settingsPagePreload(page)
    .load()
    .then(
      (module) => {
        if (queryClient) module.prefetch?.(queryClient);
      },
      () => undefined,
    );
}

/** `warmSettingsPage` for a link's target, which may carry a hash. */
export function warmSettingsPath(to: string, queryClient?: QueryClient): void {
  warmSettingsPage(findSettingsPage(to.split(/[?#]/)[0]), queryClient);
}

/** Warms one page per idle moment. Returns a function that stops the rest. */
export function warmSettingsPages(
  pages: readonly SettingsPage[],
  queryClient?: QueryClient,
): () => void {
  let stopped = false;
  let cancelIdle = () => {};
  const next = (index: number) => {
    if (stopped || index >= pages.length) return;
    cancelIdle = whenIdle(() => {
      settingsPagePreload(pages[index])
        .load()
        .then((module) => {
          if (queryClient && !stopped) module.prefetch?.(queryClient);
        })
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

export function useWarmSettingsPages(viewer: SettingsViewer): void {
  const { isAdmin, authRequired } = viewer;
  const queryClient = useContext(QueryClientContext);
  useEffect(
    () =>
      warmSettingsPages(
        visibleSettingsPages({ isAdmin, authRequired }),
        queryClient,
      ),
    [isAdmin, authRequired, queryClient],
  );
}

/** Link handlers. Without a query client in context, only code is warmed. */
export function useWarmSettingsLink(to: string) {
  const queryClient = useContext(QueryClientContext);
  return useMemo(() => {
    const warm = () => warmSettingsPath(to, queryClient);
    return { onPointerEnter: warm, onFocus: warm, onPointerDown: warm };
  }, [to, queryClient]);
}

/**
 * The app's idle warm-up: Settings' shell, then every visible page's code
 * (about 106 KB gzipped). Data waits for Settings or a link's intent.
 */
export function useWarmSettingsFromApp(): void {
  const { isAdmin, authRequired } = useAuth();
  useEffect(() => {
    let stopped = false;
    let stopPages = () => {};
    const stopShell = whenIdle(() => {
      settingsShell.load().then(
        () => {
          if (stopped) return;
          stopPages = warmSettingsPages(
            visibleSettingsPages({ isAdmin, authRequired }),
          );
        },
        () => undefined,
      );
    });
    return () => {
      stopped = true;
      stopShell();
      stopPages();
    };
  }, [isAdmin, authRequired]);
}
