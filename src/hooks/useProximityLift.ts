/**
 * useProximityLift: rows that rise toward the pointer, the nearest most.
 *
 * The Network list is the one list a person scans with the pointer all day.
 * With this, the row under the pointer rises a little, and the row beside it
 * rises too, more as the pointer nears it. Which neighbour depends on which
 * half of the row the pointer is in: in the lower half the row below starts
 * to rise, in the upper half the row above. Nothing jumps: at a row's centre
 * it has the whole lift and its neighbours none, and on the line between two
 * rows each has half.
 *
 * The lift of a row is a number from 0 to 1, written to its `--p` custom
 * property. `.proximity-row` in `index.css` turns it into a rise of up to
 * 2 px and a soft shadow, so the look lives in one place. The curve is a
 * raised cosine over one row's pitch, the centre-to-centre distance:
 *
 *   p(d) = (1 + cos(π·d)) / 2 for d < 1, else 0
 *
 * which is flat at the centre and at the edge, so a pointer resting near
 * either does not make the rows tremble.
 *
 * Nothing renders. A pointer move stores the pointer's position and asks for
 * one animation frame, and that frame finds the row under the pointer, reads
 * its box and its neighbour's, and writes `--p` on at most two rows, and
 * clears the rows lifted before. React never hears about it, so a list of
 * four hundred contacts does not render again as the pointer moves.
 *
 * Only a mouse lifts rows. A touch has no hover, and a row that rose under a
 * finger would stay up after it. A key pressed in the list lays the rows
 * down, because the keyboard moves the selection and a lifted row the
 * pointer left behind would compete with it. A scroll moves the rows under
 * a still pointer, so it lifts again from where the pointer is.
 *
 * @module hooks/useProximityLift
 */
import { useEffect, type RefObject } from "react";

/** The attribute that makes an element a row this hook lifts. */
export const PROXIMITY_ROW_ATTR = "data-proximity-row";

/** The space between two rows, for a row with no neighbour on that side. */
const ROW_GAP_PX = 8;

/** The lift at `d` row pitches from a row's centre, from 1 to 0. */
export function liftAt(d: number): number {
  return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.max(0, d)));
}

export function useProximityLift(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;

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
      const centre = box.top + box.height / 2;
      const neighbour = rows[index + (pointer.y >= centre ? 1 : -1)] ?? null;
      let pitch = box.height + ROW_GAP_PX;
      if (neighbour) {
        const other = neighbour.getBoundingClientRect();
        pitch = Math.abs(other.top + other.height / 2 - centre) || pitch;
      }
      const d = Math.min(1, Math.abs(pointer.y - centre) / pitch);
      const next = new Map([[current, liftAt(d)]]);
      if (neighbour) next.set(neighbour, liftAt(1 - d));
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
  }, [containerRef, enabled]);
}
