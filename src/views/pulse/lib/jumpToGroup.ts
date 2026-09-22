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
 * Returns false when the heading is not on the page (the group is empty or
 * the card is hidden), so the caller can fall back to a card.
 *
 * @module views/pulse/lib/jumpToGroup
 */
import type { UpNextGroup } from "./upNext";

/** The id of a group's heading. The masthead's counts jump to these. */
export const groupHeadingId = (group: UpNextGroup) => `up-next-${group}`;

/** The pane the queue scrolls in. `UpNextCard` names it. */
export const UP_NEXT_PANE_SELECTOR = '[aria-label="Up next items"]';

export function jumpToGroup(group: UpNextGroup): boolean {
  if (typeof document === "undefined") return false;
  const heading = document.getElementById(groupHeadingId(group));
  if (!heading) return false;

  const behavior: ScrollBehavior = "smooth";
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
