/**
 * The guard in front of a page's own single keys: Pulse, Ask Contrack and
 * Possible duplicates.
 *
 * @module views/pulse/lib/pageKeys
 */
import { isTypingTarget } from "../../../lib/keyboard";

/** A dialog, a menu, an open list of options or the palette, on screen. */
const OVERLAY =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [cmdk-dialog]';

/**
 * Returns `true` when a page's own shortcut must leave this key alone:
 * another control used it first, it holds ⌘, Ctrl or Alt, focus is in a
 * field, or a dialog or a menu is open. D pressed in an open Snooze menu
 * used to complete the Up next row behind it.
 */
export function pageKeyTaken(e: KeyboardEvent): boolean {
  return (
    e.defaultPrevented ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    isTypingTarget(e) ||
    document.querySelector(OVERLAY) !== null
  );
}
