/**
 * The Network list's rows rise toward the pointer, the nearest most. The row
 * under the pointer rises, and the row beside it (below in the row's lower
 * half, above in its upper half) rises more as the pointer nears it. At a
 * row's center it has the whole lift. On the line between two rows each has
 * half.
 *
 * A row's lift is 0 to 1 in its `--p` property, and `.proximity-row` in
 * `index.css` draws it. The curve is a raised cosine over one row's pitch,
 * the center-to-center distance:
 *
 *   p(d) = (1 + cos(π·d)) / 2 for d < 1, else 0
 *
 * It is flat at the center and at the edge, so a resting pointer does not
 * make the rows tremble.
 *
 * Nothing renders. A pointer move asks for one animation frame, which reads
 * the boxes and writes `--p` on at most two rows, so four hundred contacts do
 * not render again as the pointer moves.
 *
 * Only a mouse lifts rows: a row that rose under a finger would stay up. A
 * key pressed in the list lays the rows down, because the keyboard moves the
 * selection. A scroll lifts again from where the pointer is.
 */
import { useEffect, type RefObject } from "react";

/** The attribute that makes an element a row this hook lifts. */
export const PROXIMITY_ROW_ATTR = "data-proximity-row";

/** The space between two rows, for a row with no neighbor on that side. */
const ROW_GAP_PX = 8;

/** The lift at `d` row pitches from a row's center, from 1 to 0. */
function liftAt(d: number): number {
  return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.max(0, d)));
}

export function useProximityLift(
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const selector = `[${PROXIMITY_ROW_ATTR}]`;
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    /** The row the pointer is over, kept while it crosses a gap. */
    let current: HTMLElement | null = null;
    let lifted = new Map<HTMLElement, number>();

    const write = (next: Map<HTMLElement, number>) => {
      for (const row of lifted.keys()) {
        if (!next.has(row)) row.style.removeProperty("--p");
      }
      for (const [row, p] of next) row.style.setProperty("--p", p.toFixed(3));
      lifted = next;
    };

    const settle = () => {
      current = null;
      write(new Map());
    };

    const apply = () => {
      frame = 0;
      if (!pointer) return settle();
      // Optional: a document with no layout (jsdom) has no hit testing.
      const hit = document.elementFromPoint?.(pointer.x, pointer.y);
      const row = hit?.closest<HTMLElement>(selector) ?? null;
      if (row && root.contains(row)) current = row;
      if (!current || !root.contains(current)) return settle();

      const rows = Array.from(root.querySelectorAll<HTMLElement>(selector));
      const index = rows.indexOf(current);
      const box = current.getBoundingClientRect();
      const center = box.top + box.height / 2;
      const neighbor = rows[index + (pointer.y >= center ? 1 : -1)] ?? null;
      let pitch = box.height + ROW_GAP_PX;
      if (neighbor) {
        const other = neighbor.getBoundingClientRect();
        pitch = Math.abs(other.top + other.height / 2 - center) || pitch;
      }
      const d = Math.min(1, Math.abs(pointer.y - center) / pitch);
      const next = new Map([[current, liftAt(d)]]);
      if (neighbor) next.set(neighbor, liftAt(1 - d));
      write(next);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    const onScroll = () => {
      if (pointer) schedule();
    };
    const onKeyDown = () => {
      pointer = null;
      cancelAnimationFrame(frame);
      frame = 0;
      settle();
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
      settle();
    };
  }, [containerRef]);
}
