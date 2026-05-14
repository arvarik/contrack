/**
 * useClickOutside — Generic "click outside" dismiss hook.
 *
 * Replaces the copy-pasted `useEffect(() => { document.addEventListener('mousedown', ...`
 * pattern that was duplicated across ContactList and other dropdown components.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useClickOutside(ref, () => setOpen(false), isOpen);
 */
import { useEffect, type RefObject } from "react";

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutsideClick: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutsideClick();
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutsideClick, enabled]);
}
