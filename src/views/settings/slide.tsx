/**
 * The slide between the settings list and a settings page, below `lg`.
 *
 * On a phone or a tablet the list and a page take the same screen. Opening a
 * page slides it in from the right, and the back link slides it out to the
 * right. From `lg` the rail is on screen and a page swaps in place, so
 * nothing slides there.
 *
 * The View Transitions API takes a picture of the screen before and after
 * the move, and CSS animates the two (the "Settings: the slide" block at the
 * end of `src/index.css`). React Router's own `viewTransition` option works
 * only with a data router, and the app uses `BrowserRouter`, so this starts
 * the transition itself:
 *
 * 1. It sets `data-settings-slide` on the root to "forward" or "back", which
 *    picks the keyframes.
 * 2. It starts the transition. The browser keeps the old picture on screen
 *    while the update callback runs.
 * 3. The callback navigates and waits until the shell has drawn the new page
 *    (`settleSlide`), and until no page is still on its way (`PageFallback`),
 *    so the new picture is the page and not "Loading…". It never waits more
 *    than `MAX_WAIT_MS`.
 *
 * Reduced motion, from the system or the Motion row (`data-motion`), a
 * browser without the API, and a door out of Settings (Tracked contacts)
 * navigate at once, with no picture and no wait.
 *
 * @module views/settings/slide
 */
import React, { useCallback } from "react";
import { Link, useNavigate, type LinkProps } from "react-router-dom";
import { WIDE_QUERY } from "../../hooks/useMediaQuery";
import { findSettingsPage } from "./registry";

export type SlideDirection = "forward" | "back";

/** The longest the screen holds the old picture while the new page loads. */
const MAX_WAIT_MS = 350;

interface Pending {
  path: string;
  arrived: boolean;
  finish: () => void;
}

let pending: Pending | null = null;
let loadingPages = 0;
/** The latest slide. Only it may clear the direction off the root. */
let slideId = 0;

function tryFinish() {
  if (pending?.arrived && loadingPages === 0) pending.finish();
}

/** The shell calls this once it has drawn the route for `pathname`. */
export function settleSlide(pathname: string) {
  if (!pending || pending.path !== pathname) return;
  pending.arrived = true;
  tryFinish();
}

/**
 * A page's fallback calls this while it is on screen. The slide waits for it
 * to go, so the picture it takes is the page itself.
 */
export function holdSlide(): () => void {
  loadingPages += 1;
  return () => {
    loadingPages -= 1;
    tryFinish();
  };
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => {
    finished: Promise<void>;
  };
};

function wantsSlide(doc: ViewTransitionDocument): boolean {
  if (typeof doc.startViewTransition !== "function") return false;
  if (window.matchMedia?.(WIDE_QUERY).matches) return false;
  if (doc.documentElement.dataset.motion === "reduced") return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * `navigate`, with the slide. `to` may carry a hash (a search result's
 * row); the wait matches on the path alone.
 */
export function useSlideNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: string, direction: SlideDirection) => {
      const doc = document as ViewTransitionDocument;
      // A door (Tracked contacts) leaves Settings: there is no settings page
      // to slide in, only a redirect, so it opens at once, from a search hit
      // as from the list.
      const door = findSettingsPage(to.split(/[?#]/)[0])?.door;
      if (door || !wantsSlide(doc)) {
        navigate(to);
        return;
      }
      const root = doc.documentElement;
      const id = ++slideId;
      root.dataset.settingsSlide = direction;
      const transition = doc.startViewTransition!(
        () =>
          new Promise<void>((resolve) => {
            const entry: Pending = {
              path: to.split(/[?#]/)[0],
              arrived: false,
              finish: () => {
                window.clearTimeout(timer);
                if (pending === entry) pending = null;
                resolve();
              },
            };
            const timer = window.setTimeout(entry.finish, MAX_WAIT_MS);
            pending = entry;
            navigate(to);
          }),
      );
      // A slide that starts while this one waits for its page makes the
      // browser skip this one, whose `finished` then settles first. Its
      // cleanup must leave the newer slide's direction in place.
      const clear = () => {
        if (id === slideId) delete root.dataset.settingsSlide;
      };
      transition.finished.then(clear, clear);
    },
    [navigate],
  );
}

/** A modified click (a new tab, a new window) belongs to the browser. */
export function isPlainClick(event: React.MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

/**
 * Starts loading a settings page's code, so it is there when the link's
 * click lands. The module system keeps the one copy, so a second call costs
 * nothing, and a failure here is left for the page's own load to report.
 */
function prefetchPage(to: string) {
  findSettingsPage(to.split(/[?#]/)[0])
    ?.load()
    .catch(() => undefined);
}

/**
 * A link from the settings list into a page, which slides the page in below
 * `lg`. It is still a link: its `href` is real, and a modified click opens a
 * tab as any link does. A press starts loading the page, a tenth of a second
 * or so before the click.
 */
export const SlideLink = ({
  to,
  onClick,
  onPointerDown,
  ...rest
}: Omit<LinkProps, "to"> & { to: string }) => {
  const slide = useSlideNavigate();
  return (
    <Link
      to={to}
      {...rest}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        prefetchPage(to);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!isPlainClick(event)) return;
        event.preventDefault();
        slide(to, "forward");
      }}
    />
  );
};
