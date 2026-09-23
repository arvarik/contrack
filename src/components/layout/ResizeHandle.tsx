/**
 * ResizeHandle: the edge a person drags to make a pane wider or narrower.
 *
 * It sits on the seam between the pane and the content beside it: a
 * zero-width box on the pane's edge, inside the pane (and its landmark), with
 * its grip reaching over the neighbour's edge. The pane is the element the
 * handle is placed in, and it must paint over its neighbour for the grip to
 * take the pointer. It draws nothing at rest. A pointer over
 * it shows a hairline, and a drag shows the line in the primary. Keyboard
 * focus draws the one focus ring, inset, as a 4 px bar on the seam.
 *
 * It is a focusable separator (the WAI-ARIA window splitter): the arrow keys
 * move it by `RESIZE_STEP`, Shift by `RESIZE_STEP_LARGE`, Home and End go to
 * the bounds, and a double click restores the default width. A press that
 * does not move swaps between the default width and the widest the window
 * allows: the way to resize with one pointer and no drag (WCAG 2.5.7).
 *
 * A drag writes one custom property per frame and nothing else. The pointer
 * is captured, so the moves keep arriving as it leaves the handle, and the
 * moves are gathered into one write per animation frame. React hears about
 * the drag once, when it ends. A press does not move focus: a person typing
 * a note can widen the list and keep typing.
 *
 * @module components/layout/ResizeHandle
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
 * A press that does not move waits this long for a second press before it
 * swaps the width. The swap moves the handle from under the pointer, so
 * done at once it would send a double click's second press past the handle.
 */
export const DOUBLE_PRESS_MS = 300;

export interface ResizeHandleProps extends PaneWidthBounds {
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
 * Keep the resize cursor and stop text selection on the whole page while a
 * drag runs. The pointer leaves the handle as soon as it moves, and every
 * row and link under it has its own cursor. Returns the undo.
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
  // The pane is the element the handle sits in. A ref on the pane would
  // not do: React attaches a parent's ref after its children's layout
  // effects, so on the first commit the width hook would find no pane and
  // draw no width. The box's own ref is attached by then.
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
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={limit}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
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
        // 4 px just past the seam, and a 12 px grip from the `::after` box
        // that reaches outward only: the list's letter rail runs to the
        // seam, and none of its letters is under the grip. The ring is drawn
        // inset, so it fills the 4 px as one bar.
        className="group absolute inset-y-0 left-0 w-1 cursor-col-resize touch-none select-none focus-visible:-outline-offset-2 after:absolute after:inset-y-0 after:left-0 after:-right-2"
      >
        {/* The line. A pointer that only crosses the seam shows nothing:
            the hairline waits one base duration before it fades in. Under
            the focus ring it takes the ring's colour, so the bar stays one
            bar when the pointer rests on it too. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-outline-variant group-hover:delay-(--dur-base) group-focus-visible:bg-primary group-data-dragging:bg-primary group-data-dragging:delay-0"
        />
      </div>
    </div>
  );
};
