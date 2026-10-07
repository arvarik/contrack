/**
 * The slide between the settings list and a settings page, below `lg`, where
 * the two share one screen. From `lg` the rail stays on screen and a page
 * swaps in place.
 *
 * React Router's `viewTransition` needs a data router and the app uses
 * `BrowserRouter`, so this starts the View Transition itself. It sets
 * `data-settings-slide` on the root to pick the keyframes (end of
 * `src/index.css`), navigates inside the update callback, and waits for
 * `settleSlide` and for no `PageFallback`, so the new picture is the page and
 * not "Loading…". The wait never passes `MAX_WAIT_MS`.
 *
 * Reduced motion, a browser without the API and a link out of Settings
 * navigate at once. The Network list and a contact slide the same way: their
 * roots carry `settings-stage` and call `settleSlide`.
 */
import React, { useCallback } from "react";
import { Link, useNavigate, type LinkProps } from "react-router-dom";
import { WIDE_QUERY } from "../../hooks/useMediaQuery";
import { prefersReducedMotion } from "../../lib/motion";
import { useWarmSettingsLink } from "./warm";

type SlideDirection = "forward" | "back";

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

/** A page's fallback holds the slide while it is on screen. */
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
  return !prefersReducedMotion();
}

/** True below `lg`, with motion, in a browser with the API. */
export function canSlide(): boolean {
  return wantsSlide(document as ViewTransitionDocument);
}

/** `navigate` with the slide. The wait matches the path without its hash. */
export function useSlideNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: string, direction: SlideDirection) => {
      const doc = document as ViewTransitionDocument;
      if (!wantsSlide(doc)) {
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
      // A newer slide makes the browser skip this one, whose `finished`
      // settles first. Its cleanup must keep the newer direction.
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
 * A real link into a settings page that slides the page in below `lg`.
 * Hover, focus or press warms the page code and data (`warm.ts`).
 */
export const SlideLink = ({
  to,
  onClick,
  onPointerDown,
  ...rest
}: Omit<LinkProps, "to"> & { to: string }) => {
  const slide = useSlideNavigate();
  const warm = useWarmSettingsLink(to);
  return (
    <Link
      to={to}
      onPointerEnter={warm.onPointerEnter}
      onFocus={warm.onFocus}
      {...rest}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        warm.onPointerDown();
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
