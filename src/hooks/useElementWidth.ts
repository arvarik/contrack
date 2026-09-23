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
import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Follow an element's width and keep only what `read` makes of it. React
 * skips the render when `read` gives the value it already has.
 */
function useWidthReading<T>(
  element: HTMLElement | null,
  read: (width: number) => T,
): T | null {
  const [value, setValue] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    setValue(read(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setValue(read(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, read]);

  return value;
}

const asIs = (width: number) => width;

export function useElementWidth(element: HTMLElement | null): number | null {
  return useWidthReading(element, asIs);
}

/**
 * Whether the element is at least `min` px wide, or null before it is
 * measured. It keeps the answer and not the width, so the component renders
 * again only when the width crosses `min`. Dragging the Network list's edge
 * resizes the contact's pane on every frame, and a kept width rendered the
 * whole contact page again each time.
 */
export function useElementWidthAtLeast(
  element: HTMLElement | null,
  min: number,
): boolean | null {
  const atLeast = useCallback((width: number) => width >= min, [min]);
  return useWidthReading(element, atLeast);
}
