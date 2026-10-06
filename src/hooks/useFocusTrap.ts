import { useEffect, type RefObject } from "react";

/** Every focusable, enabled element. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  'input:not(:disabled):not([type="hidden"])',
  "select:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Keeps Tab inside a container while `enabled`: Tab on the last focusable
 * element wraps to the first, and Shift+Tab on the first to the last.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = (
        Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ) as HTMLElement[]
      ).filter((el) => el.offsetParent !== null); // Exclude visually hidden (display: none)

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

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [containerRef, enabled]);
}
