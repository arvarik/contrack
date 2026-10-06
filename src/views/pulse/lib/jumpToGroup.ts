/**
 * Scroll the page to a group heading inside the Up next queue.
 *
 * The masthead's counts and the Keeping up card's "to catch up" button both
 * land on a group of the queue, so the one scroll lives here. From `lg` the
 * queue scrolls inside its card, so the pane scrolls to the heading and the
 * page only brings the card into view, which keeps the masthead on screen.
 * Below `lg` the heading is in the page's own flow and scrolls into view
 * itself.
 *
 * Below `lg` the queue shows its first rows and a "Show all" button. A
 * group further down is not on the page, so the jump asks the queue to show
 * every row first (`SHOW_ALL_UP_NEXT`).
 *
 * Returns false when the heading is not on the page (the group is empty or
 * the card is hidden), so the caller can fall back to a card.
 *
 * @module views/pulse/lib/jumpToGroup
 */
import { scrollBehavior } from "../../../lib/a11y";
import type { UpNextGroup } from "./upNext";

/** The event that makes the Up next card show every row, at once. */
export const SHOW_ALL_UP_NEXT = "pulse:show-all-up-next";

/** The id of a group's heading. The masthead's counts jump to these. */
export const groupHeadingId = (group: UpNextGroup) => `up-next-${group}`;

/** The pane the queue scrolls in. `UpNextCard` names it. */
const UP_NEXT_PANE_SELECTOR = '[aria-label="Up next items"]';

export function jumpToGroup(group: UpNextGroup): boolean {
  if (typeof document === "undefined") return false;
  const find = () => document.getElementById(groupHeadingId(group));
  let heading = find();
  if (!heading) {
    window.dispatchEvent(new Event(SHOW_ALL_UP_NEXT));
    heading = find();
  }
  if (!heading) return false;

  const behavior = scrollBehavior();
  const pane = heading.closest<HTMLElement>(UP_NEXT_PANE_SELECTOR);
  const paneScrolls =
    pane && /auto|scroll/.test(getComputedStyle(pane).overflowY);
  if (pane && paneScrolls) {
    const top =
      heading.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop;
    pane.scrollTo?.({ top, behavior });
    pane
      .closest("[data-card-id]")
      ?.scrollIntoView?.({ behavior, block: "nearest" });
  } else {
    heading.scrollIntoView?.({ behavior, block: "start" });
  }
  return true;
}
