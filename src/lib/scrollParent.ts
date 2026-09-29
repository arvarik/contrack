/**
 * The nearest ancestor of an element that scrolls vertically.
 *
 * A settings page scrolls in the shell's one scroller, and a few lists
 * scroll in a box of their own. Code that sticks a block to a scroller's
 * edge, or draws only the rows of a long list that are on screen, reads the
 * scroller from here. It returns null when no ancestor scrolls, as in a unit
 * test, where the caller does nothing.
 *
 * @module lib/scrollParent
 */
export function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}
