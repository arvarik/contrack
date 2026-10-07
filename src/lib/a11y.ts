/**
 * Keyboard helpers for the ARIA patterns the app builds by hand: an element
 * that acts as a button where a `<button>` cannot be used (it holds another
 * control), and a radio group.
 */
import type { KeyboardEvent, PointerEvent } from "react";

/**
 * Run `handler` on Enter or Space, as a native button does, without the
 * page scroll or the form submit. A key from a nested element is ignored, so
 * a button inside a clickable card does not also fire the card.
 *
 * @example
 * <div role="button" tabIndex={0} onClick={open} onKeyDown={activateOnKey(open)}>
 */
export function activateOnKey(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    handler();
  };
}

/**
 * The arrow keys of an option in a radio group. Right and Down move to the
 * next option, Left and Up to the one before, wrapping at the ends, and the
 * option reached takes focus and is chosen by its own click. It sits on each
 * radio, where focus is, because a radiogroup is not focusable.
 *
 * @example
 * <button role="radio" aria-checked={on} tabIndex={radioTabIndex(on, i, any)} onKeyDown={radioKeys} />
 */
export function radioKeys(event: KeyboardEvent<HTMLElement>) {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  // The disabled options are skipped, but the one the focus is on stays in
  // the list: a checked option that cannot be chosen now, such as an engine
  // that lost its setup, holds the tab stop, and the arrows must leave it.
  const options = [
    ...group.querySelectorAll<HTMLElement>('[role="radio"]'),
  ].filter(
    (option) =>
      option === event.currentTarget ||
      (!option.matches(":disabled") &&
        option.getAttribute("aria-disabled") !== "true"),
  );
  const from = options.indexOf(event.currentTarget);
  if (from === -1) return;
  event.preventDefault();
  const next = options[(from + step + options.length) % options.length];
  next.focus();
  next.click();
}

/**
 * The tab stop of an option in a radio group: the checked option, or the
 * first when none is (a stored value that matches no preset), so the group
 * is always one Tab stop and never none.
 */
export function radioTabIndex(
  checked: boolean,
  index: number,
  anyChecked: boolean,
): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}

/**
 * Hovering a row in a menu or a list box focuses it, as in the system's own
 * menus, so a menu shows one current row, not two. A touch never moves
 * focus: a finger on a list is scrolling it.
 */
export function focusOnPointer(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") return;
  const row = event.currentTarget;
  if (row.getAttribute("aria-disabled") === "true") return;
  if (document.activeElement !== row) row.focus({ preventScroll: true });
}

/**
 * How a scroll the app starts should move: at once when the Motion setting
 * or the system asks for less motion, smoothly otherwise. A script that asks
 * for "smooth" overrides the CSS, so it asks here first.
 */
export function scrollBehavior(): ScrollBehavior {
  const motion = document.documentElement.getAttribute("data-motion");
  if (motion === "reduced") return "auto";
  if (motion === "full") return "smooth";
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
