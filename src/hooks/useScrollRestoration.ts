/**
 * useScrollRestoration — Persists the scroll position of a scrollable container
 * across navigations using sessionStorage.
 *
 * Usage:
 *   const scrollRef = useScrollRestoration('contact-list');
 *   <div ref={scrollRef} className="overflow-y-auto">...</div>
 *
 * The key should be unique per scroll container (e.g. the route name).
 * Position is saved on scroll (debounced) and on unmount for safety.
 * Restored after a single animation frame to allow layout to settle.
 */
import { useRef, useEffect } from "react";

const STORAGE_PREFIX = "contrack_scroll_";
const DEBOUNCE_MS = 150;

export const useScrollRestoration = <T extends HTMLElement = HTMLDivElement>(
  key: string,
) => {
  const ref = useRef<T>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Restore position after layout paint
    const saved = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (saved !== null) {
      const pos = parseInt(saved, 10);
      requestAnimationFrame(() => {
        if (ref.current) ref.current.scrollTop = pos;
      });
    }

    // Save on scroll (debounced)
    const onScroll = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (ref.current) {
          sessionStorage.setItem(
            `${STORAGE_PREFIX}${key}`,
            String(ref.current.scrollTop),
          );
        }
      }, DEBOUNCE_MS);
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Also save on unmount (catch cases where scroll didn't fire)
      if (ref.current) {
        sessionStorage.setItem(
          `${STORAGE_PREFIX}${key}`,
          String(ref.current.scrollTop),
        );
      }
    };
  }, [key]);

  return ref;
};
