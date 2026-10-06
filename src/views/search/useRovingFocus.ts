/**
 * useRovingFocus: a list of results as one Tab stop.
 *
 * Ask Contrack's results and the Manual merge picker gave every result its
 * own Tab stop, so thirty results were thirty presses of Tab before the
 * next control. Here one result is in the Tab order, the arrows walk the
 * others, and Tab leaves the list in one press:
 *
 *   ArrowDown, ArrowUp   the next or previous result
 *   Home, End            the first or last result
 *
 * Enter and Space stay with the result itself, a button. A list that draws
 * only the rows near the screen (`VirtualRows`) works too: a step lands on
 * a drawn neighbor, and focus scrolls it into view. A row that is not
 * drawn takes no focus, and the Tab stop stays where it was: a stop on a
 * missing row took the whole list out of the Tab order.
 *
 * @module views/search/useRovingFocus
 */
import type React from "react";
import { useCallback, useRef, useState } from "react";

const KEY_STEP: Record<string, (i: number, count: number) => number> = {
  ArrowDown: (i) => i + 1,
  ArrowUp: (i) => i - 1,
  Home: () => 0,
  End: (_, count) => count - 1,
};

export function useRovingFocus(count: number) {
  const [stored, setStored] = useState(0);
  const active = Math.min(stored, Math.max(count - 1, 0));
  const listRef = useRef<HTMLDivElement>(null);

  /** Focus a result, when it is drawn. Its focus moves the Tab stop. */
  const focusAt = useCallback(
    (index: number) => {
      const target = Math.min(Math.max(index, 0), count - 1);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-roving="${target}"]`)
        ?.focus();
    },
    [count],
  );

  /** Spread on each result. */
  const itemProps = (index: number) => ({
    "data-roving": index,
    tabIndex: index === active ? 0 : -1,
    onFocus: () => setStored(index),
    onKeyDown: (e: React.KeyboardEvent) => {
      const step = KEY_STEP[e.key];
      if (!step || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      focusAt(step(index, count));
    },
  });

  return { listRef, itemProps, focusAt };
}
