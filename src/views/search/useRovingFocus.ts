/**
 * A list of results as one Tab stop. The arrows, Home and End move between
 * results, and Tab leaves the list in one press.
 *
 * In a virtualized list (`VirtualRows`), a row that is not drawn takes no
 * focus, so the Tab stop stays where it was. A stop on a missing row takes
 * the whole list out of the Tab order.
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
