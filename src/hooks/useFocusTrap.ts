import { useEffect, type RefObject } from 'react';

/**
 * Focus-trapping selector — matches all natively focusable, non-disabled elements.
 *
 * Covers: links with href, buttons, textareas, inputs (non-hidden), selects,
 * and anything with an explicit non-negative tabindex.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'textarea:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * useFocusTrap — Traps Tab/Shift+Tab cycling within a container.
 *
 * When `enabled` is true, pressing Tab on the last focusable element wraps to
 * the first, and Shift+Tab on the first wraps to the last. This keeps keyboard
 * focus inside modal dialogs per WAI-ARIA best practices.
 *
 * Zero dependencies — avoids adding `focus-trap-react` for ~25 lines of logic.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = (Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ) as HTMLElement[]).filter((el) => el.offsetParent !== null); // Exclude visually hidden (display: none)

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab on first element → wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab on last element → wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [containerRef, enabled]);
}
