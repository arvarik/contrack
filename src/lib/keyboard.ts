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
