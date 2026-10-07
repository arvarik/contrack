/**
 * The contact list as one Tab stop (a roving `tabindex`): one row is in the
 * Tab order, and keys move focus between rows.
 *
 *   ArrowDown, ArrowUp   the next or previous row
 *   PageDown, PageUp     a screen of rows on or back
 *   Home, End            the first or last row
 *   a letter or a digit  the next row whose label starts with it, wrapping
 *   Enter                opens the row (a link opens itself, or `onOpen`)
 *   Space                clicks the row: opens it, or picks it in select mode
 *
 * Space and PageDown do not scroll the list: a scroll takes the focused row
 * out of the virtualized range, and focus falls to the page.
 *
 * The Tab-stop row is not always mounted. Moving focus scrolls to the row and
 * retries for a few frames until it mounts and stays. While it is scrolled
 * out, the container takes the Tab stop and hands focus on to the row.
 *
 * One stable handler reads the row's index from a data attribute, so
 * memoized rows do not re-render.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { scrollParent } from "../../lib/scrollParent";

export const ROVING_INDEX_ATTR = "data-roving-index";

/** How many frames to keep trying to focus a row before giving up. */
const MAX_FRAMES = 60;

/**
 * How many frames focus must stay on the row before the hook lets go. A
 * re-measure can unmount a just-mounted row and drop focus.
 */
const HOLD_FRAMES = 4;

interface RovingListOptions {
  /** How many rows the list holds, mounted or not. */
  count: number;
  /** Takes the Tab stop when it changes, such as the open contact. */
  selectedIndex?: number;
  /** The row's element, or null when the virtualizer has not mounted it. */
  getElement: (index: number) => HTMLElement | null;
  /** The text type-ahead matches against, usually the name. */
  getLabel: (index: number) => string;
  /** Bring the row into view. Omit for a list that is not virtualized. */
  scrollToIndex?: (index: number) => void;
  /** Whether the row is mounted now. Omit when every row always is. */
  isRendered?: (index: number) => boolean;
  /** What Enter does. Omit when the rows are links and open themselves. */
  onOpen?: (index: number) => void;
}

export interface RovingItemProps {
  tabIndex: 0 | -1;
  [ROVING_INDEX_ATTR]: number;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
}

interface RovingList {
  /** Move the Tab stop to a row, scroll it into view and focus it. */
  focusIndex: (index: number) => void;
  /** Spread on each row. */
  getItemProps: (index: number) => RovingItemProps;
  /** Spread on the element that scrolls the rows. */
  containerProps: {
    tabIndex: 0 | undefined;
    onFocus: (event: React.FocusEvent<HTMLElement>) => void;
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
}

const clamp = (index: number, count: number) =>
  Math.min(Math.max(index, 0), Math.max(count - 1, 0));

function indexOf(element: EventTarget | null): number | null {
  if (!(element instanceof HTMLElement)) return null;
  const raw = element.getAttribute(ROVING_INDEX_ATTR);
  return raw === null ? null : Number(raw);
}

/** About a screen of rows: the scroller's height in rows of this one's. */
function pageOf(row: HTMLElement): number {
  const scroller = scrollParent(row);
  return scroller && row.offsetHeight
    ? Math.max(1, Math.floor(scroller.clientHeight / row.offsetHeight) - 1)
    : 10;
}

const initialOf = (label: string) => label.trim().charAt(0).toLocaleLowerCase();

export function useRovingList(options: RovingListOptions): RovingList {
  const { count, selectedIndex = -1, isRendered } = options;
  const [storedIndex, setStoredIndex] = useState(() =>
    selectedIndex >= 0 ? selectedIndex : 0,
  );
  const activeIndex = count === 0 ? -1 : clamp(storedIndex, count);

  // For handlers that keep one identity, so memoized rows do not re-render.
  const optionsRef = useRef(options);
  const activeRef = useRef(activeIndex);
  useLayoutEffect(() => {
    optionsRef.current = options;
    activeRef.current = activeIndex;
  });

  // Tab back into the list lands on the open contact.
  useEffect(() => {
    if (selectedIndex >= 0) setStoredIndex(selectedIndex);
  }, [selectedIndex]);

  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const focusIndex = useCallback((index: number) => {
    const { count, scrollToIndex } = optionsRef.current;
    if (count === 0) return;
    const target = clamp(index, count);
    setStoredIndex(target);
    activeRef.current = target;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    scrollToIndex?.(target);

    let frames = 0;
    let held = 0;
    let landed = false;
    const attempt = () => {
      frame.current = null;
      const element = optionsRef.current.getElement(target);
      const active = document.activeElement;
      if (element && active === element) {
        held += 1;
        if (held >= HOLD_FRAMES) return;
      } else {
        // Focus moved on to another control (Enter opened the contact): stop.
        // Focus on the document means the row unmounted: try again.
        if (landed && active && active !== document.body) return;
        held = 0;
        if (element) {
          // The browser's scroll-into-view and the virtualizer's both align
          // to the nearest edge, so they agree.
          element.focus();
          landed ||= document.activeElement === element;
        } else {
          // Ask again: a list that was just hidden measured its rows at zero.
          optionsRef.current.scrollToIndex?.(target);
        }
      }
      frames += 1;
      if (frames > MAX_FRAMES) return;
      frame.current = requestAnimationFrame(attempt);
    };
    attempt();
  }, []);

  const onItemKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const current = indexOf(event.currentTarget);
      if (current === null) return;
      const { count, getLabel, onOpen } = optionsRef.current;
      if (count === 0) return;

      const move = (next: number) => {
        event.preventDefault();
        focusIndex(next);
      };

      switch (event.key) {
        case "ArrowDown":
          return move(Math.min(current + 1, count - 1));
        case "ArrowUp":
          return move(Math.max(current - 1, 0));
        case "PageDown":
          return move(
            Math.min(current + pageOf(event.currentTarget), count - 1),
          );
        case "PageUp":
          return move(Math.max(current - pageOf(event.currentTarget), 0));
        case " ":
          event.preventDefault();
          event.currentTarget.click();
          return;
        case "Home":
          return move(0);
        case "End":
          return move(count - 1);
        case "Enter":
          if (onOpen) {
            event.preventDefault();
            onOpen(current);
          }
          return;
      }

      // Type-ahead: pressing "m" twice walks through the Ms.
      if (event.key.length !== 1 || !/[\p{L}\p{N}]/u.test(event.key)) return;
      const wanted = event.key.toLocaleLowerCase();
      for (let step = 1; step <= count; step++) {
        const candidate = (current + step) % count;
        if (initialOf(getLabel(candidate)) === wanted) return move(candidate);
      }
      // No match still consumes the key, so it does not reach a page shortcut
      // such as "n".
      event.preventDefault();
    },
    [focusIndex],
  );

  const onItemFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const index = indexOf(event.currentTarget);
    if (index !== null) {
      setStoredIndex(index);
      activeRef.current = index;
    }
  }, []);

  const getItemProps = useCallback(
    (index: number): RovingItemProps => ({
      tabIndex: index === activeIndex ? 0 : -1,
      [ROVING_INDEX_ATTR]: index,
      onKeyDown: onItemKeyDown,
      onFocus: onItemFocus,
    }),
    [activeIndex, onItemKeyDown, onItemFocus],
  );

  // A pointer press on the scroller never jumps to the active row.
  const pointerDown = useRef(false);
  const onContainerFocus = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || pointerDown.current) return;
      if (optionsRef.current.count > 0) focusIndex(activeRef.current);
    },
    [focusIndex],
  );

  const activeUnmounted =
    activeIndex >= 0 && isRendered !== undefined && !isRendered(activeIndex);

  return {
    focusIndex,
    getItemProps,
    containerProps: {
      tabIndex: activeUnmounted ? 0 : undefined,
      onFocus: onContainerFocus,
      onPointerDown: () => {
        pointerDown.current = true;
      },
      onPointerUp: () => {
        pointerDown.current = false;
      },
      onPointerCancel: () => {
        pointerDown.current = false;
      },
    },
  };
}
