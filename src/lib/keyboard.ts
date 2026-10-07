/** The guards a keyboard shortcut checks before it fires. */

/**
 * True when focus is where a person types: a native field, a
 * `contentEditable` (the Tiptap editor), a `textbox` or `combobox` role, or
 * the command palette. A shortcut must not fire there.
 */
export function isTypingTarget(e?: KeyboardEvent): boolean {
  const el = (document.activeElement || e?.target) as HTMLElement | null;
  if (!el) return false;

  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;

  const role = el.getAttribute("role");
  if (role === "textbox" || role === "combobox") return true;

  if (el.closest("[cmdk-input]")) return true;

  // Anywhere in the open palette, the dialog itself included: its keys are
  // its own.
  if (el.closest("[cmdk-dialog]")) return true;

  return false;
}

/**
 * True when focus is on a control that Enter or Space activates on its own,
 * such as a link, a button or a menu item. A page's Enter shortcut must not
 * swallow that press.
 */
export function isActivationTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return false;
  return (
    el.closest(
      [
        "a[href]",
        "button",
        "summary",
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="menuitemradio"]',
        '[role="option"]',
        '[role="radio"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="tab"]',
      ].join(", "),
    ) !== null
  );
}

/** A dialog, a menu, an open list of options or the palette, over the page. */
const OVERLAY = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[cmdk-dialog]",
].join(", ");

/** Whether a dialog, a menu, an open list or the palette is on screen. */
export function overlayIsOpen(): boolean {
  return document.querySelector(OVERLAY) !== null;
}

/**
 * True when a page's own shortcut must leave this key alone: another control
 * used it first, it holds ⌘, Ctrl or Alt (⌘V is a paste), focus is in a
 * field, or a dialog or a menu is open over the page.
 */
export function isPageKeyTaken(e: KeyboardEvent): boolean {
  return (
    e.defaultPrevented ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    isTypingTarget(e) ||
    overlayIsOpen()
  );
}

/** Whether the element scrolls its own content up and down. */
export function isScroller(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.scrollHeight > el.clientHeight &&
    /auto|scroll/.test(getComputedStyle(el).overflowY)
  );
}
