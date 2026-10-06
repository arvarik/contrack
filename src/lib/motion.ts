/**
 * The app's timing: one curve and three durations, the numbers index.css
 * holds as `--ease` and `--dur-*`, for `motion/react`, which takes numbers.
 * Fast is a press or a menu opening, base is a hover or a color change, slow
 * is something arriving. A spring or a deliberate long animation keeps its
 * own numbers.
 *
 *   <motion.div transition={{ duration: DURATION.base, ease: EASE }} />
 */

/** The three durations, in seconds for `motion/react`. */
export const DURATION = {
  fast: 0.12,
  base: 0.16,
  slow: 0.24,
} as const;

/** The one curve: a fast start that settles, as a cubic-bezier. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Gap between consecutive tiles. Short enough to read as one gesture. */
const STEP_MS = 35;

/** Ceiling for the whole sequence, however many tiles there are. */
const MAX_STAGGER_MS = 200;

/**
 * The entrance delay of the tile at `index`, for `.tile-enter`. Tiles arrive
 * in reading order, but the last is never more than MAX_STAGGER_MS behind
 * the first, so a page does not sit half-empty.
 *
 * @example tileDelay(9) // "200ms", clamped
 */
export const tileDelay = (index: number): string =>
  `${Math.min(index * STEP_MS, MAX_STAGGER_MS)}ms`;

/**
 * Whether motion is off: Reduced in the Motion setting (`data-motion` on the
 * root) or in the system. CSS transitions stop on their own, so a script
 * animation asks here before it starts. False without a window, so a test
 * runs the move.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const setting =
    typeof document === "undefined"
      ? null
      : document.documentElement.getAttribute("data-motion");
  return (
    setting === "reduced" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
