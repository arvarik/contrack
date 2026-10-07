/**
 * A long list that draws only the rows near the screen. Drawing every row,
 * 5,824 contacts took 44 s to show the Manual merge tab.
 *
 * 1. Up to `VIRTUAL_ROWS` rows it is a plain list, so jsdom (no layout) sees
 *    every row.
 * 2. Past that it draws the rows the virtualizer asks for, in the nearest
 *    scrolling ancestor (`lib/scrollParent`). The box keeps the full height,
 *    so the scrollbar is true. With no scrolling ancestor it is a plain list.
 * 3. The list's distance from the scroller's top is `scrollMargin`. Content
 *    above can change height, so it is measured after every commit and saved
 *    only when it moves.
 * 4. Each drawn row is measured, so a tall row pushes the rows under it.
 *
 * The gap is `gap` in px, not `space-y`: a margin on a row placed by
 * `transform` does not move the next row.
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { scrollParent } from "../../lib/scrollParent";

/** Past this many rows a list draws only the rows near the screen. */
export const VIRTUAL_ROWS = 200;

interface VirtualRowsProps<T> {
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

  // After every commit: something above may have changed height. It cannot
  // loop: the offset does not depend on the margin, saved only when it moves.
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
