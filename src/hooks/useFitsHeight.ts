/**
 * useFitsHeight: whether an element fits inside a scroller's visible height.
 *
 * The contact page keeps its Details column in view while the timeline
 * scrolls, with `position: sticky`. A sticky column taller than the view
 * cannot show its own bottom until the timeline beside it ends, so the last
 * fields sat out of reach. The column is sticky only while this hook says it
 * fits, and scrolls with the page when it does not.
 *
 * `margin` is the room kept above and below the element, in px. Both boxes
 * are watched, so a field added to the column or a window made shorter
 * changes the answer. True until both elements exist.
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
