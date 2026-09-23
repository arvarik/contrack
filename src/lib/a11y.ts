/**
 * a11y.ts — helpers for making non-button elements behave like buttons.
 *
 * The app has a number of places where a `<div>` or `<span>` carries an
 * onClick: clickable cards, click-to-edit text, custom dropdown rows. A real
 * `<button>` is always the better answer and is used where it is possible —
 * but it is not always possible, because a button may not contain another
 * interactive element, and several of these wrappers legitimately do (a card
 * with its own action buttons inside, a row containing a link).
 *
 * For those, the correct markup is the ARIA button pattern: a role, a tab
 * stop, and a key handler that responds to the same keys a real button does.
 * Doing that by hand at twenty call sites invites twenty subtly different
 * versions, so it lives here once.
 *
 * @module lib/a11y
 */
import type { KeyboardEvent, PointerEvent } from "react";

/**
 * Run `handler` when the element is activated by keyboard, matching native
 * button behaviour: Enter and Space both fire.
 *
 * Space is prevented from scrolling the page, which is what the browser would
 * otherwise do — and Enter from submitting an enclosing form.
 *
 * Events originating from a nested interactive element are ignored, so a
 * button inside a clickable card does not also trigger the card.
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
 * Props that turn a static element into a keyboard-operable button.
 *
 * Spread this rather than remembering the trio each time:
 * `<div {...buttonLike(open)} className="…">`
 *
 * @param handler what activation should do
 * @param label   accessible name, when the element's text is not enough
 */
export function buttonLike(handler: () => void, label?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: handler,
    onKeyDown: activateOnKey(handler),
    ...(label ? { "aria-label": label } : {}),
  };
}

/**
 * The arrow keys of an option in a radio group. Right and Down move to the
 * next option, Left and Up to the one before, wrapping at the ends, and the
 * option they reach takes focus and is chosen, by its own click.
 *
 * On each radio rather than on the group, where focus is: a group that
 * listens has to be focusable itself, which a radiogroup is not. `Segmented`
 * and `AccentPicker` do the same with their own values.
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
  const options = [
    ...group.querySelectorAll<HTMLElement>(
      '[role="radio"]:not(:disabled):not([aria-disabled="true"])',
    ),
  ];
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
 * Hovering a row in a menu or a list box makes it the current row: it takes
 * focus, as in the system's own menus. The row focused when the menu opened
 * gives up its tint, so a menu opened by a click shows one current row, the
 * one under the pointer, and not two. A touch never moves focus: a finger
 * on a list is scrolling it.
 */
export function focusOnPointer(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") return;
  const row = event.currentTarget;
  if (row.getAttribute("aria-disabled") === "true") return;
  if (document.activeElement !== row) row.focus({ preventScroll: true });
}
