/**
 * useDismissable — an open thing that closes on a click elsewhere or Escape.
 *
 * `useClickOutside` covered the pointer half; every menu that used it then
 * wrote its own Escape handler, or forgot to. A menu that traps a keyboard
 * user is worse than one that does not open.
 *
 * Returns the ref to put on the element that counts as "inside".
 */
import { useEffect, useRef, type RefObject } from "react";
import { useClickOutside } from "./useClickOutside";

export function useDismissable<T extends HTMLElement>(
  open: boolean,
  close: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  useClickOutside(ref, close, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
  return ref;
}
