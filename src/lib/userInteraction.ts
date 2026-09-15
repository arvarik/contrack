/**
 * userInteraction.ts — has the person done anything on this page yet?
 *
 * Moving focus is right when a person caused the change and wrong when they
 * did not. Opening a contact from the list should put focus on its name, but
 * loading a contact's address fresh should not: a focused element becomes the
 * point the next Tab starts from, so the first Tab on a freshly loaded page
 * would skip the skip link, the sidebar and the list, and land somewhere in the
 * middle of the page.
 *
 * The first pointer press or key press on the page flips this for good. Both
 * listeners capture, so they run before any handler that navigates.
 *
 * @module lib/userInteraction
 */

let interacted = false;

if (typeof window !== "undefined") {
  const mark = () => {
    interacted = true;
  };
  window.addEventListener("pointerdown", mark, { capture: true, once: true });
  window.addEventListener("keydown", mark, { capture: true, once: true });
}

/** True once the person has pressed a key or a pointer anywhere on the page. */
export const hasUserInteracted = (): boolean => interacted;
