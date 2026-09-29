/**
 * Warm: a settings page starts loading before its link is pressed.
 *
 * Every settings page is its own lazy module, so the first click on a page
 * waited for its code, and a page with lists of its own (Account's devices,
 * tokens and passkeys) then showed "Loading…" rows that pushed its cards
 * down. Two things now start earlier:
 *
 * 1. The code of every page the viewer can open, one page per idle moment,
 *    once Settings is on screen (`useWarmSettingsPages`), and the first
 *    data of a page that has a `prefetch`. A browser told to save data is
 *    left alone (`lib/idle`).
 * 2. A page's code and its first data when a person points at, focuses or
 *    presses its link (`useWarmSettingsLink`): the page's module may export
 *    a `prefetch`, and the rail, the list and the search results call it.
 *    React Query keeps what arrives, so the page reads it on its first
 *    render, and a list read a moment ago is not read again.
 *
 * A page whose code has arrived renders at once (`settingsPagePreload`, on
 * `lib/preloadable`): a plain `React.lazy` page suspended even then, and
 * React held it behind "Loading…" for 300 ms.
 *
 * Only pages the viewer can see are warmed, so a member never asks for an
 * admin page's data, and the Account page's lists are asked for only on an
 * instance that has accounts.
 *
 * @module views/settings/warm
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

/**
 * Settings' shell. The app renders `settingsShell.Component`, which is at
 * once when this code is here: a plain `React.lazy` view suspended even
 * then, and React held Settings back for 300 ms.
 */
export const settingsShell = preloadable(() =>
  import("./SettingsShell").then((m) => ({ default: m.SettingsShell })),
);

/** Starts Settings' shell, for a link to Settings a person points at. */
export function warmSettingsShell(): void {
  settingsShell.load().catch(() => undefined);
}

const pagePreloads = new Map<string, Preloadable<object, SettingsPageModule>>();

/**
 * A page's code, downloaded once and kept, and its component, which renders
 * at once when the code is kept and suspends when it is not.
 */
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

/** The pages this viewer can open. */
export function visibleSettingsPages(viewer: SettingsViewer): SettingsPage[] {
  return SETTINGS_PAGES.filter((page) => isSettingsPageVisible(page, viewer));
}

/**
 * Loads a page's code and, with a query client, starts its data. A failure
 * here is left for the page's own load to report.
 */
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

/**
 * Warms each page in turn, one per idle moment: its code, and its first
 * data with a query client. Returns a function that stops the rest.
 */
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

/** The shell's warm-up: every page this viewer can open. */
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

/**
 * The handlers a settings link spreads to warm its page. The query client is
 * read from context, not required: without one, only the code is warmed.
 */
export function useWarmSettingsLink(to: string) {
  const queryClient = useContext(QueryClientContext);
  return useMemo(() => {
    const warm = () => warmSettingsPath(to, queryClient);
    return { onPointerEnter: warm, onFocus: warm, onPointerDown: warm };
  }, [to, queryClient]);
}

/**
 * The app's warm-up, in idle moments like the map's: Settings' shell, then
 * the code of every settings page this viewer can open, one page per idle
 * moment. All of it is about 106 KB gzipped. Settings and each of its pages
 * then open at once, with no "Loading…" between them. The data waits for
 * Settings itself (`useWarmSettingsPages`) or a link's intent.
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
