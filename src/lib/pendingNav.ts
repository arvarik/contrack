/**
 * pendingNav: the page a person has asked for, before it is on screen.
 *
 * A navigation is a transition (React Router's `BrowserRouter` starts one
 * for each location change), and the app has one page boundary above every
 * route. So while a page's code is still on its way, the page on screen
 * stays, and `useLocation` keeps the old path. That is right for the page,
 * and wrong for the navigation itself: the sidebar went on marking the old
 * page, and a press on a link that had to wait looked like a press that did
 * nothing.
 *
 * A link marks its path here when it is pressed, outside the transition, so
 * the sidebar and the tab bar mark the new page in the same frame. The app
 * clears the mark once a new location is on screen (`useSettlePendingNav`),
 * and Back or Forward clears it too. A press on the page already on screen
 * marks nothing: no new location would come to clear it, and the next
 * navigation that sets no mark would paint the old mark for a frame.
 *
 * Only the sidebar and the tab bar read the mark, so a press re-renders the
 * navigation and not the page under it.
 *
 * @module lib/pendingNav
 */
import { useEffect, useSyncExternalStore, type MouseEvent } from "react";
import { useLocation } from "react-router-dom";

let pending: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Back and Forward end any press still waiting for its page. */
const onPopState = () => clearPendingNav();

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("popstate", onPopState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("popstate", onPopState);
    }
  };
}

/** Marks `path` (a pathname, or a link's `to` with a query) as asked for. */
export function markPendingNav(path: string): void {
  const pathname = path.split(/[?#]/)[0];
  if (typeof window !== "undefined" && window.location.pathname === pathname) {
    return;
  }
  if (pending === pathname) return;
  pending = pathname;
  emit();
}

/**
 * A link's `onClick` that marks `to`, for a plain click only. A click with a
 * modifier key or another button opens the page in another tab or window,
 * and this tab stays where it is, so a mark would stay on the wrong page.
 */
export function markPendingNavOnClick(to: string) {
  return (event: MouseEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    markPendingNav(to);
  };
}

/** Clears the mark: the page asked for is on screen, or the ask is gone. */
export function clearPendingNav(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

/** The pathname a person has asked for and does not see yet, or null. */
export function usePendingNav(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
}

/**
 * Clears the mark each time a new location is on screen. The location's key
 * is new on every navigation, one to the same path included. The app calls
 * it once, where it reads the location already.
 */
export function useSettlePendingNav(): void {
  const { key } = useLocation();
  useEffect(() => clearPendingNav(), [key]);
}
