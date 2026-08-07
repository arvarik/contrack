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
import type { KeyboardEvent } from "react";

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
