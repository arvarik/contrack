/**
 * keptImages: the pictures the app showed last, held in memory.
 *
 * Chrome keeps a loaded picture in its memory cache only while something
 * holds it. A page that unmounts lets go of every picture on it, and the
 * next mount reads each one back from the disk cache, a frame after its row
 * has drawn. On each return to the Network page, every avatar in the list
 * showed its gray circle for that frame, and every company logo was missing.
 *
 * A picture that has loaded calls `keepImage`, which holds it in an `Image`
 * here. A row built again then finds its picture in memory and paints it in
 * the same frame as the row. `decoding="sync"` does not help: the picture
 * was not there to decode.
 *
 * The last `KEEP_LIMIT` pictures are held, the oldest let go first. An
 * avatar is a few KB, and the Network list shows about 30 at a time.
 *
 * @module lib/keptImages
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
