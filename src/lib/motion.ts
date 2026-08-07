/**
 * motion.ts — Entrance-animation timing, in one place.
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
