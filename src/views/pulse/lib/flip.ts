/**
 * FLIP slides for the Pulse grid while a card is moved: `capture` measures
 * every card before a change, and `play` slides each card that moved from
 * its old place to its new one.
 *
 * Only `transform` animates, so no frame lays the page out again, and
 * dnd-kit, which measures without the transform, still finds a sliding card
 * at its real place. Reduced motion turns it off.
 */
import { DURATION, EASE, prefersReducedMotion } from "../../../lib/motion";

/** The app's one curve, for the Web Animations API and dnd-kit. */
export const EASE_CSS = `cubic-bezier(${EASE.join(", ")})`;

/** Lets the next change find and stop the running slides. */
const FLIP_ID = "pulse-flip";

interface Flip {
  capture: () => void;
  play: () => void;
}

/**
 * Matches elements by `data-flip-id`, so a card that moved to another column
 * (a new element with the same id) slides across too.
 */
export function createFlip(getRoot: () => HTMLElement | null): Flip {
  const attribute = "data-flip-id";
  let before: Map<string, DOMRect> | null = null;
  const nodes = () =>
    Array.from(
      getRoot()?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [],
    );

  return {
    capture() {
      if (prefersReducedMotion()) {
        before = null;
        return;
      }
      const rects = new Map<string, DOMRect>();
      for (const node of nodes()) {
        rects.set(node.getAttribute(attribute)!, node.getBoundingClientRect());
      }
      before = rects;
    },

    play() {
      const last = before;
      before = null;
      if (!last) return;
      const list = nodes();
      // Cancel, then read, then write: one layout pass for the whole batch.
      for (const node of list) {
        for (const animation of node.getAnimations?.() ?? []) {
          if (animation.id === FLIP_ID) animation.cancel();
        }
      }
      const moves = list.map((node) => {
        const from = last.get(node.getAttribute(attribute)!);
        if (!from) return null;
        const to = node.getBoundingClientRect();
        return { node, dx: from.left - to.left, dy: from.top - to.top };
      });
      for (const move of moves) {
        if (!move || (Math.abs(move.dx) < 1 && Math.abs(move.dy) < 1)) continue;
        const animation = move.node.animate?.(
          [
            { transform: `translate(${move.dx}px, ${move.dy}px)` },
            { transform: "none" },
          ],
          { duration: DURATION.slow * 1000, easing: EASE_CSS },
        );
        if (animation) animation.id = FLIP_ID;
      }
    },
  };
}
