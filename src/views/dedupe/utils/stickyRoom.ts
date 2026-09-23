/**
 * Scroll padding for a sticky block, kept on the scroller it sticks in.
 *
 * The Duplicates page is one scroller, and blocks stick to its edges: the
 * cluster list's bar and the picker's chips and search at the top, and
 * Compare at the bottom. The browser scrolls a control that Tab reaches to
 * the edge of the scroller's padding box. Without the padding, Shift+Tab up
 * the picker stopped a row under the search, and Tab down it stopped a row
 * under Compare (WCAG 2.4.11).
 *
 * The padding is the block's height, its sticky offset and an 8 px gap for
 * the focus ring. It is measured again when the block changes size: the
 * chips wrap, and the bar takes two lines on a phone. The block's `ref`
 * takes `roomAtTop` or `roomAtBottom`. A scroller that is not found, as in
 * a unit test, leaves the ref doing nothing.
 *
 * @module views/dedupe/utils/stickyRoom
 */

type Side = "top" | "bottom";

const PROPERTY = {
  top: "scrollPaddingTop",
  bottom: "scrollPaddingBottom",
} as const;

/** The nearest ancestor that scrolls vertically. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

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

/** The ref for a block stuck to the top of the page's scroller. */
export const roomAtTop = stickyRoom("top");

/** The ref for a block stuck to the bottom of the page's scroller. */
export const roomAtBottom = stickyRoom("bottom");
