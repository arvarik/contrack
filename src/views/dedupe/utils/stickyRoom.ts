/**
 * Scroll padding for a sticky block, set on the scroller it sticks in, so a
 * control Tab reaches is not hidden under the block (WCAG 2.4.11).
 *
 * The padding is the block's height, its sticky offset and 8 px for the
 * focus ring, measured again when the block resizes. Pass `roomAtTop` or
 * `roomAtBottom` as the block's `ref`. With no scroller found, it does
 * nothing.
 */

import { scrollParent } from "../../../lib/scrollParent";

type Side = "top" | "bottom";

const PROPERTY = {
  top: "scrollPaddingTop",
  bottom: "scrollPaddingBottom",
} as const;

function stickyRoom(side: Side) {
  return (block: HTMLElement | null) => {
    const scroller = block && scrollParent(block);
    if (!block || !scroller) return;
    const property = PROPERTY[side];
    const measure = () => {
      const offset = parseFloat(getComputedStyle(block)[side]) || 0;
      scroller.style[property] = `${block.offsetHeight + offset + 8}px`;
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(block);
    return () => {
      observer?.disconnect();
      scroller.style[property] = "";
    };
  };
}

export const roomAtTop = stickyRoom("top");

export const roomAtBottom = stickyRoom("bottom");
