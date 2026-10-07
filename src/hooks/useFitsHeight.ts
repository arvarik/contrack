/**
 * Whether an element fits inside a scroller's visible height. The contact
 * page's Details column is sticky beside the timeline, and a sticky column
 * taller than the view cannot show its own bottom until the timeline ends.
 * So the column is sticky only while this says it fits.
 *
 * `margin` is the room kept above and below, in px. Both boxes are watched,
 * so a new field or a shorter window changes the answer. True until both
 * elements exist.
 */
import { useLayoutEffect, useState } from "react";

export function useFitsHeight(
  element: HTMLElement | null,
  scroller: HTMLElement | null,
  margin = 0,
): boolean {
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    if (!element || !scroller) return;
    const measure = () =>
      setFits(
        element.getBoundingClientRect().height + margin <=
          scroller.clientHeight,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [element, scroller, margin]);

  return fits;
}
