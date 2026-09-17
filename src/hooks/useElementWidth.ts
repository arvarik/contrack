/**
 * useElementWidth: an element's width in px, kept in step with it.
 *
 * A media query reads the window. The contact page needs the width of its
 * own pane, which the window does not give: at 1024 px the sidebar and the
 * 350 px contact list sit beside the contact, so its pane is about 600 px
 * wide on a window that `lg` calls wide. Two columns there left the timeline
 * about 160 px wide.
 *
 * Pass the element from a callback ref (`ref={setElement}`), so the hook sees
 * it on the render that mounts it. The first width is read in a layout
 * effect, before the browser paints, so the page never shows the wrong
 * layout for a frame. A `ResizeObserver` follows it after that.
 *
 * Returns null until there is an element to measure.
 */
import { useLayoutEffect, useState } from "react";

export function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return width;
}
