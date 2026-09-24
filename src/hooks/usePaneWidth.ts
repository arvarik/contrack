/**
 * usePaneWidth: the width of a pane a person can resize, kept per device.
 *
 * The width lives in a CSS custom property on the pane (`--pane-width`), and
 * the pane's own class reads it. So a new width is one style write: nothing
 * in the pane re-renders while a drag runs, and React sees one state update
 * when the drag ends.
 *
 * Three widths are in play:
 *
 *   - the stored width: what the person chose, between `min` and `max`, in
 *     `localStorage` for this device;
 *   - the room: the widest the pane can be on this window and still leave
 *     `keep` px beside it (the open contact);
 *   - the width: the stored width, held inside the room.
 *
 * A narrow window holds the pane in, and a wider one gives the stored width
 * back, so a resize of the window never overwrites the choice.
 *
 * Every storage read and write is in `try`: a private window or a blocked
 * site can throw, and the pane then keeps `initial`.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export interface PaneWidthBounds {
  /** The width with nothing stored, and the one a reset restores. */
  initial: number;
  /** The narrowest the pane gets. */
  min: number;
  /** The widest the pane gets, on a window with room for it. */
  max: number;
  /** The least room the pane leaves beside it, for the page's content. */
  keep: number;
}

export interface PaneWidthOptions extends PaneWidthBounds {
  /** The pane. Its parent is the row it shares with the content. */
  paneRef: RefObject<HTMLElement | null>;
  /** The custom property the pane's width class reads. */
  property: `--${string}`;
  /** The `localStorage` key for this device's width. */
  storageKey: string;
}

export interface PaneWidth {
  /** The pane's width now, in px. */
  width: number;
  /** The widest the pane can be on this window. `max` or less. */
  limit: number;
  /** Draw a width without keeping it: one frame of a drag. */
  preview: (width: number) => number;
  /** Draw a width and keep it on this device. Returns the width drawn. */
  commit: (width: number) => number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(Math.round(value), low), high);

/**
 * The width stored under `key`, held inside the bounds, or `initial` when
 * nothing usable is stored or storage throws.
 *
 * @param key - The `localStorage` key.
 * @param bounds - The pane's bounds.
 * @returns A width in px.
 */
export function readPaneWidth(key: string, bounds: PaneWidthBounds): number {
  try {
    // `parseFloat`, not `Number`: an empty string is not 0 px.
    const stored = Number.parseFloat(localStorage.getItem(key) ?? "");
    if (Number.isFinite(stored)) return clamp(stored, bounds.min, bounds.max);
  } catch {
    // Storage is unavailable: keep the default.
  }
  return bounds.initial;
}

export function usePaneWidth(options: PaneWidthOptions): PaneWidth {
  const { paneRef, property, storageKey, initial, min, max, keep } = options;

  // What the person chose. A ref, because a drag's frames read it and
  // nothing renders from it.
  const stored = useRef<number | null>(null);
  if (stored.current === null) {
    stored.current = readPaneWidth(storageKey, { initial, min, max, keep });
  }
  const [state, setState] = useState(() => ({
    width: stored.current ?? initial,
    limit: max,
  }));
  const limitRef = useRef(max);

  /** The widest the pane can be and still leave `keep` px beside it. */
  const measureLimit = useCallback(() => {
    const pane = paneRef.current;
    const row = pane?.parentElement?.getBoundingClientRect();
    // No layout: a hidden row, or a document with no boxes.
    if (!pane || !row || row.width === 0) return max;
    const room = row.right - pane.getBoundingClientRect().left - keep;
    return clamp(room, min, max);
  }, [paneRef, min, max, keep]);

  const draw = useCallback(
    (width: number) => {
      const next = clamp(width, min, limitRef.current);
      paneRef.current?.style.setProperty(property, `${next}px`);
      return next;
    },
    [paneRef, property, min],
  );

  // Draw the stored width before the first paint, and hold it inside the
  // room each time the window changes size.
  useLayoutEffect(() => {
    const fit = () => {
      limitRef.current = measureLimit();
      const width = draw(stored.current ?? initial);
      const limit = limitRef.current;
      setState((prev) =>
        prev.width === width && prev.limit === limit ? prev : { width, limit },
      );
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [measureLimit, draw, initial]);

  const commit = useCallback(
    (width: number) => {
      const next = draw(width);
      stored.current = next;
      setState((prev) =>
        prev.width === next ? prev : { width: next, limit: prev.limit },
      );
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Storage is unavailable: the width lasts until the page reloads.
      }
      return next;
    },
    [draw, storageKey],
  );

  return { width: state.width, limit: state.limit, preview: draw, commit };
}
