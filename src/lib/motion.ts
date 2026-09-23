/**
 * motion.ts — the app's timing, in one place.
 *
 * One curve and three durations, the same numbers `src/index.css` holds as
 * `--ease`, `--dur-fast`, `--dur-base` and `--dur-slow`. CSS transitions read
 * the custom properties. `motion/react` takes numbers, so it reads these:
 *
 *   <motion.div transition={{ duration: DURATION.base, ease: EASE }} />
 *
 * Fast is a press or a menu opening, base is a hover or a colour change, slow
 * is something arriving on the page. A spring or a deliberate long animation
 * (a toast that waits, the corvid's flight) keeps its own numbers.
 *
 * Views used to hand-pick per-tile `delay` values (0.1, 0.2, … 0.7). Over a
 * seven-tile dashboard that is 700ms of the page sitting half-empty while
 * elements arrive one at a time, which reads as flicker rather than polish —
 * especially when a query resolving mid-sequence re-mounts the subtree and
 * restarts the whole chain.
 *
 * `tileDelay` caps the ramp: tiles still arrive in reading order, but the last
 * one is never more than MAX_STAGGER_MS behind the first.
 *
 * Pair with the `.tile-enter` class from index.css:
 *
 *   <div className="tile-enter" style={{ animationDelay: tileDelay(i) }} />
 *
 * @module lib/motion
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
 * Entrance delay for the tile at `index`, as a CSS time string.
 *
 * @example tileDelay(0) // "0ms"
 * @example tileDelay(9) // "200ms" — clamped
 */
export const tileDelay = (index: number): string =>
  `${Math.min(index * STEP_MS, MAX_STAGGER_MS)}ms`;
