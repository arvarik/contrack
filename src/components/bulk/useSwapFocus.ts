/**
 * Keep focus on the page when a mode's button swaps for its counterpart.
 *
 * Select turns into Done, and Done back into Select. The pressed button
 * leaves the page, focus left with it to `<body>`, and the next Tab started
 * from the top of the document. When the mode flips and nothing has focus,
 * the button that took the pressed one's place gets it. Focus in the bulk
 * bar counts as lost too when the mode ends: CSV or Escape can end it from
 * a bar button, and the bar leaves once its exit animation is done, taking
 * focus with it. Focus somewhere else, such as a row the arrow keys reached
 * before Escape, stays where it is. The two buttons must be keyed apart, or
 * React relabels the pressed one in place and focus stays on whatever takes
 * its slot.
 *
 * @module components/bulk/useSwapFocus
 */
import { useEffect, useRef, type RefObject } from "react";

/** The bulk bar on the Network list and the Tracked page. It leaves with the mode. */
const LEAVING_BAR = '[role="toolbar"][aria-label="Bulk actions"]';

/**
 * @param on True while the mode is on, such as select mode.
 * @param onButton The button the mode shows, such as Done.
 * @param offButton The button shown without the mode, such as Select.
 */
export function useSwapFocus(
  on: boolean,
  onButton: RefObject<HTMLElement | null>,
  offButton: RefObject<HTMLElement | null>,
): void {
  const was = useRef(on);
  useEffect(() => {
    if (was.current === on) return;
    was.current = on;
    const active = document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      (!on && active.closest(LEAVING_BAR) !== null);
    if (!lost) return;
    (on ? onButton : offButton).current?.focus();
  }, [on, onButton, offButton]);
}
