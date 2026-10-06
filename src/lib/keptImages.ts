/**
 * The pictures the app showed last, held in memory. Chrome keeps a picture
 * in its memory cache only while something holds it, so a remounted row
 * would read its avatar back from the disk cache a frame late and flash a
 * gray circle. `keepImage` holds each loaded picture in an `Image`, the last
 * `KEEP_LIMIT` of them, oldest dropped first.
 */
import type { SyntheticEvent } from "react";

export const KEEP_LIMIT = 120;

/** Held pictures by address, the oldest first (a Map keeps its order). */
const kept = new Map<string, HTMLImageElement>();

/** Holds the picture at `src`, as the newest. */
export function keepImage(src: string): void {
  if (!src || typeof Image === "undefined") return;
  const held = kept.get(src);
  if (held) {
    kept.delete(src);
    kept.set(src, held);
    return;
  }
  const image = new Image();
  image.src = src;
  kept.set(src, image);
  if (kept.size > KEEP_LIMIT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
}

/** True while the picture at `src` is held. */
export function isImageKept(src: string): boolean {
  return kept.has(src);
}

/** An `<img>`'s `onLoad`: holds the picture it has just shown. */
export function keepLoadedImage(event: SyntheticEvent<HTMLImageElement>) {
  keepImage(event.currentTarget.src);
}
