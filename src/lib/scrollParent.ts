/**
 * The nearest ancestor of an element that scrolls vertically, for code that
 * sticks a block to a scroller's edge or draws only the visible rows. Null
 * when none scrolls, as in a unit test.
 */
export function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}
