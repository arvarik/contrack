/**
 * The edge a person drags to resize a pane: a zero-width box on the pane's
 * edge, inside the pane, its grip reaching over the neighbor. The pane must
 * paint over its neighbor for the grip to take the pointer. Nothing at rest,
 * a hairline on hover, the primary while dragging.
 *
 * A focusable separator (the WAI-ARIA window splitter): the arrows move it by
 * `RESIZE_STEP`, Shift by `RESIZE_STEP_LARGE`, Home and End go to the bounds,
 * and a double click restores the default. A press that does not move swaps
 * the default for the widest width, for one pointer and no drag (WCAG 2.5.7).
 *
 * A drag writes one custom property per animation frame, with the pointer
 * captured, and tells React once, when it ends. A press does not move focus.
 */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { cn } from "../../lib/utils";
import { usePaneWidth, type PaneWidthBounds } from "../../hooks/usePaneWidth";

/** An arrow key moves the edge this far, in px. */
export const RESIZE_STEP = 16;
/** Shift and an arrow key move it this far, in px. */
export const RESIZE_STEP_LARGE = 64;
/**
 * A still press waits this long for a second press before it swaps the
 * width: the swap moves the handle from under the pointer.
 */
export const DOUBLE_PRESS_MS = 300;

interface ResizeHandleProps extends PaneWidthBounds {
  /** The custom property the pane's width class reads. */
  property: `--${string}`;
  /** The `localStorage` key for this device's width. */
  storageKey: string;
  /** The separator's name, for example "Resize the contact list". */
  label: string;
  /** Classes for the seam's box: `hidden lg:block` and its place on the pane's edge. */
  className?: string;
}

/**
 * Keeps the resize cursor and stops text selection on the whole page while
 * a drag runs, since the pointer leaves the handle. Returns the undo.
 */
function holdPage(): () => void {
  const style = document.createElement("style");
  style.textContent =
    "*{cursor:col-resize!important;user-select:none!important;-webkit-user-select:none!important}";
  document.head.appendChild(style);
  return () => style.remove();
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  x: number;
  frame: number;
  release: () => void;
  /** The press came while a first press waited: a double click. */
  second: boolean;
}

export const ResizeHandle = ({
  property,
  storageKey,
  label,
  className,
  ...bounds
}: ResizeHandleProps) => {
  const { initial, min } = bounds;
  const box = useRef<HTMLDivElement>(null);
  // The pane is the handle's parent. Not a ref on the pane: React attaches
  // a parent's ref after its children's layout effects.
  const paneRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return box.current?.parentElement ?? null;
      },
    }),
    [],
  );
  const { width, limit, preview, commit } = usePaneWidth({
    paneRef,
    property,
    storageKey,
    ...bounds,
  });
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const swap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelSwap = () => {
    clearTimeout(swap.current);
    swap.current = undefined;
  };

  // A drag cut short by an unmount gives the page its cursor back, and a
  // waiting swap is dropped.
  useEffect(
    () => () => {
      clearTimeout(swap.current);
      const current = drag.current;
      if (!current) return;
      cancelAnimationFrame(current.frame);
      current.release();
    },
    [],
  );

  const widthAt = (current: Drag) =>
    current.startWidth + current.x - current.startX;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    // No text selection, no touch scroll, and no focus move.
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser does not track: the moves still arrive
      // while the pointer stays on the handle.
    }
    const second = swap.current !== undefined;
    cancelSwap();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      x: event.clientX,
      frame: 0,
      release: holdPage(),
      second,
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.x = event.clientX;
    if (current.frame) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      const next = preview(widthAt(current));
      handle.current?.setAttribute("aria-valuenow", String(next));
    });
  };

  /** The press ends: `released` for a pointer up, not a cancel. */
  const onPointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
    released: boolean,
  ) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(current.frame);
    current.release();
    if (current.x !== current.startX) {
      commit(widthAt(current));
    } else if (released && !current.second) {
      // A press with no movement swaps the default for the widest width,
      // and back, unless a second press makes it a double click, which
      // restores the default.
      const target = width < (initial + limit) / 2 ? limit : initial;
      swap.current = setTimeout(() => {
        swap.current = undefined;
        commit(target);
      }, DOUBLE_PRESS_MS);
    }
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
    const next = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: min,
      End: limit,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    commit(next);
  };

  return (
    <div ref={box} className={cn("relative z-20 w-0 shrink-0", className)}>
      {/* A focusable separator is a widget (WAI-ARIA window splitter): it
          takes focus and the arrow keys, like a slider. */}
      <div
        ref={handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={limit}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, true)}
        onPointerCancel={(event) => onPointerEnd(event, false)}
        onLostPointerCapture={(event) => onPointerEnd(event, false)}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          cancelSwap();
          commit(initial);
        }}
        // 4 px past the seam, and a 12 px `::after` grip reaching outward
        // only, clear of the list's letter rail. The ring is inset.
        className="group absolute inset-y-0 left-0 w-1 cursor-col-resize touch-none select-none focus-visible:-outline-offset-2 after:absolute after:inset-y-0 after:left-0 after:-right-2"
      >
        {/* The line waits one base duration before it fades in, so a
            pointer crossing the seam shows nothing. Under the focus ring it
            takes the ring's color. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-outline-variant group-hover:delay-(--dur-base) group-focus-visible:bg-primary group-data-dragging:bg-primary group-data-dragging:delay-0"
        />
      </div>
    </div>
  );
};
