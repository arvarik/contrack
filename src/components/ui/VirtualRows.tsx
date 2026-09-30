/**
 * VirtualRows: a long list that draws only the rows near the screen.
 *
 * The Duplicates picker and the Enrichment list drew every contact. With
 * 5,824 contacts that was 5,824 rows and 5,824 avatar images, and the
 * Manual merge tab took 44 s to show its search box. This list draws the
 * rows in and near the scroller's view, about twenty, and moves them as the
 * scroller moves.
 *
 * 1. Up to `VIRTUAL_ROWS` rows it is a plain list: every row is in the DOM,
 *    in order, so a short list needs no measuring, and a unit test in jsdom
 *    (which has no layout) sees every row.
 * 2. Past that it finds the nearest ancestor that scrolls
 *    (`lib/scrollParent`), the page's one scroller or a box of its own, and
 *    draws the rows the virtualizer asks for. The box keeps the list's full
 *    height, so the scrollbar is true to the whole list. The first render
 *    draws the empty box, and the rows follow before the first paint. With
 *    no ancestor that scrolls, the list is a plain list again.
 * 3. The list's distance from the top of the scroller's content is the
 *    virtualizer's `scrollMargin`. Something above the list can change
 *    height (the picker's chips), so the distance is measured again after
 *    every commit, and saved only when it moves.
 * 4. Each row is measured once it is drawn, so a row taller than the
 *    estimate pushes the rows under it down, and nothing overlaps.
 *
 * The gap between rows is `gap`, in px, and not a `space-y` class: a margin
 * on a row that is placed by `transform` moves the row without moving the
 * next one.
 *
 * @module components/ui/VirtualRows
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { scrollParent } from "../../lib/scrollParent";

/** Past this many rows a list draws only the rows near the screen. */
export const VIRTUAL_ROWS = 200;

export interface VirtualRowsProps<T> {
  /** The rows' items, in order. */
  items: readonly T[];
  /** A stable key for an item, such as a contact's id. */
  getKey: (item: T) => string;
  /** One row. */
  renderRow: (item: T, index: number) => React.ReactNode;
  /** A row's height before it is drawn, in px. */
  estimateSize: number;
  /** The space between two rows, in px. */
  gap?: number;
}

export function VirtualRows<T>({
  items,
  getKey,
  renderRow,
  estimateSize,
  gap = 0,
}: VirtualRowsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  // Undefined until the list has looked for its scroller, and null when it
  // has none.
  const [scroller, setScroller] = useState<HTMLElement | null>();
  const [scrollMargin, setScrollMargin] = useState(0);
  const long = items.length > VIRTUAL_ROWS;
  const virtual = long && scroller !== null;

  useLayoutEffect(() => {
    if (long && listRef.current) {
      setScroller(scrollParent(listRef.current));
    }
  }, [long]);

  // After every commit: something above the list may have changed height.
  // No list of dependencies on purpose. It cannot loop: the offset does not
  // depend on the margin, and the margin is saved only when it moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!virtual || !list || !scroller) return;
    const offset =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((previous) =>
      Math.abs(previous - offset) > 1 ? offset : previous,
    );
  });

  const virtualizer = useVirtualizer({
    enabled: virtual && scroller !== undefined,
    count: virtual ? items.length : 0,
    getScrollElement: () => scroller ?? null,
    getItemKey: (index) => getKey(items[index]),
    estimateSize: () => estimateSize,
    gap,
    // Rows drawn past each edge of the view.
    overscan: 8,
    scrollMargin,
    // Where the scroller already is. The page may be scrolled when the list
    // appears, and the first rows drawn are the ones in view.
    initialOffset: () => scroller?.scrollTop ?? 0,
  });

  if (!virtual) {
    return (
      <div
        ref={listRef}
        style={gap ? { display: "flex", flexDirection: "column", gap } : {}}
      >
        {items.map((item, index) => (
          <React.Fragment key={getKey(item)}>
            {renderRow(item, index)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${row.start - scrollMargin}px)`,
          }}
        >
          {renderRow(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );
}
