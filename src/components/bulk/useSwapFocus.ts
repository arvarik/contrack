/**
 * Keeps focus on the page when a mode's button swaps for its counterpart
 * (Select and Done). When the mode flips with nothing focused, or with focus
 * in the leaving bulk bar, the new button takes the focus. Focus elsewhere
 * stays. The two buttons must be keyed apart, or React relabels the pressed
 * one in place.
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
