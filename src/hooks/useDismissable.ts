/**
 * An open thing that closes on a click elsewhere or on Escape, both in one
 * hook, because a menu that traps a keyboard user is worse than one that
 * does not open. Returns the ref for the element that counts as inside.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useClickOutside } from "./useClickOutside";
import { useCloseRequest } from "./useCloseRequest";

export function useDismissable<T extends HTMLElement>(
  open: boolean,
  close: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  useClickOutside(ref, close, open);
  // And Android's Back, which closes it instead of leaving the page.
  useCloseRequest(open, close);
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
