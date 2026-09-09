import { useRef, useLayoutEffect } from "react";

/** Restore a container after its data loads. Storage failures never interrupt navigation. */
export function useScrollRestoration<T extends HTMLElement = HTMLDivElement>(
  key: string,
  ready = true,
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    const storageKey = `contrack_scroll_${key}`;
    let position = 0;
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) position = saved;
    } catch {
      /* Storage can be disabled. */
    }
    element.scrollTop = position;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      try {
        sessionStorage.setItem(storageKey, String(element.scrollTop));
      } catch {
        /* Scrolling also works without storage. */
      }
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 150);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      save();
    };
  }, [key, ready]);
  return ref;
}
