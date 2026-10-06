/**
 * Whether a CSS media query matches, kept in step with it. Responsive looks
 * belong in CSS. This is for what CSS cannot change: what an element is to
 * assistive technology. The contact list is a sidebar beside the open
 * contact on a wide screen and the main content on a narrow one, and a
 * landmark role is an attribute, not a style.
 *
 * Read through `useSyncExternalStore`, so the first render has the right
 * answer and a resize across the breakpoint re-renders once.
 */
import { useCallback, useSyncExternalStore } from "react";

/** The Tailwind `lg` breakpoint, where the list and the contact sit side by side. */
export const WIDE_QUERY = "(min-width: 1024px)";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () =>
    typeof window !== "undefined" && !!window.matchMedia
      ? window.matchMedia(query).matches
      : false;
  return useSyncExternalStore(subscribe, read, () => false);
}
