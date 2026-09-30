import { useRef, useLayoutEffect } from "react";

const storageKeyFor = (key: string) => `contrack_scroll_${key}`;

/**
 * The position saved for the view `key`, or 0. A virtual list passes it to
 * its virtualizer as the first offset: the hook below restores the scroller
 * before paint, but a virtualizer that starts at 0 drew the rows at the top
 * while the scroller showed the saved place, and the first frame of the
 * Network page was an empty list.
 */
export function savedScroll(key: string): number {
  try {
    const saved = Number(sessionStorage.getItem(storageKeyFor(key)));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch {
    /* Storage can be disabled. */
  }
  return 0;
}

/** Restore a container after its data loads. Storage failures never interrupt navigation. */
export function useScrollRestoration<T extends HTMLElement = HTMLDivElement>(
  key: string,
  ready = true,
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    const storageKey = storageKeyFor(key);
    element.scrollTop = savedScroll(key);
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
