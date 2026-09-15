/**
 * keyboard.ts — Shared keyboard utilities.
 *
 * Centralizes the keyboard input guard that was previously copy-pasted
 * across 5 different components with inconsistent coverage. This ensures
 * keyboard shortcuts never fire when the user is typing in a text field,
 * contenteditable region, select, or ARIA textbox/combobox.
 */

/**
 * Returns `true` when the current focus target is a text-input element,
 * meaning keyboard shortcuts should NOT fire.
 *
 * Coverage:
 * - `<input>`, `<textarea>`, `<select>` (native)
 * - `contentEditable` divs (e.g. Tiptap editor)
 * - ARIA roles: `textbox`, `combobox` (e.g. cmdk input)
 */
export function isTypingTarget(e?: KeyboardEvent): boolean {
  const el = (document.activeElement || e?.target) as HTMLElement | null;
  if (!el) return false;

  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;

  const role = el.getAttribute("role");
  if (role === "textbox" || role === "combobox") return true;

  // cmdk search input (used by CommandPalette)
  if (el.closest("[cmdk-input]")) return true;

  return false;
}

/**
 * Returns `true` when the element with focus is a control that Enter or
 * Space activates on its own — a link, a button, a menu item, a radio — so
 * a page-level Enter shortcut must leave the key alone.
 *
 * `isTypingTarget` answers the question for letters: do not fire `n` while
 * somebody types an n. This answers it for Enter: do not swallow the press
 * that would have followed a link or pressed a button. Before this, the
 * contact list's Enter-to-compose shortcut called `preventDefault()` on
 * every Enter outside a field, so a keyboard user who tabbed to a sidebar
 * link on the Network page and pressed Enter went nowhere.
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
        '[role="menuitemcheckbox"]',
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
