/**
 * Whether the person has done anything on this page yet. Code moves focus
 * only after a person caused the change: on a freshly loaded page, a moved
 * focus would make the first Tab skip the skip link and the sidebar. The
 * first pointer or key press flips it for good. Both listeners capture, so
 * they run before any handler that navigates.
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
