/**
 * The motion of the Pulse grid while a card is moved.
 *
 * A card that changes place in the DOM jumps there. Each time the drag's
 * draft moves a card, its neighbours shift: the slot opens a gap in one
 * column and closes one in another, a card folds to its slot when it is
 * picked up, and unfolds when it is let go. FLIP makes each of those a
 * slide. `capture` measures every card before the change, `play` measures
 * them after it, and each card that moved starts from its old place with a
 * transform and slides to the new one: first, last, invert, play.
 *
 * Only `transform` animates, on the Web Animations API, so the compositor
 * runs the slide and no frame lays the page out again. dnd-kit measures the
 * cards without their transform, so a card in mid-slide is still found at
 * its real place. A card caught in mid-slide by the next change starts
 * again from where it is on screen.
 *
 * Reduced motion, from the operating system or the Motion row in Settings,
 * turns all of it off: the cards take their new places at once.
 *
 * @module views/pulse/lib/flip
 */
import { DURATION, EASE } from "../../../lib/motion";

/** The app's one curve, for the Web Animations API and dnd-kit. */
export const EASE_CSS = `cubic-bezier(${EASE.join(", ")})`;

/**
 * Whether motion is off: the operating system asks for less, or the Motion
 * row in Settings is Reduced (`data-motion` on the root). CSS transitions
 * already collapse under both, but a script animation does not, so a script
 * asks here, at the moment it would start one.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.dataset.motion === "reduced") return true;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** The id the slides carry, so the next change can find and stop them. */
const FLIP_ID = "pulse-flip";

export interface Flip {
  /** Measure where each card is on screen, before the change that moves it. */
  capture: () => void;
  /** Slide each card that moved from where it was to where it is now. */
  play: () => void;
}

/**
 * FLIP over the elements under `getRoot()` that carry `attribute`, matched
 * by its value, so a card that moved to another column (a new element with
 * the same id) slides across too.
 */
export function createFlip(
  getRoot: () => HTMLElement | null,
  attribute = "data-flip-id",
): Flip {
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
      // Stop every slide still running, then read every place, then start
      // the new slides: one layout pass between the writes and the reads.
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
