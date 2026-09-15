/**
 * useRovingList — the contact list as one Tab stop.
 *
 * Every row used to be its own Tab stop. With fifteen rows on screen and a
 * letter rail after them, a keyboard user pressed Tab forty-one times to get
 * from the top of a contact page to the contact. The pattern that fixes it is a
 * roving `tabindex`: exactly one row is in the Tab order, the arrow keys move
 * focus between rows, and Tab leaves the list in one press.
 *
 *   ArrowDown, ArrowUp   the next or previous row
 *   Home, End            the first or last row
 *   a letter or a digit  the next row whose label starts with it, wrapping
 *   Enter                opens the row (a link opens itself, or `onOpen`)
 *
 * The rows are virtualised, so the row that owns the Tab stop is not always
 * mounted. Two consequences, both handled here:
 *
 *   - Moving focus scrolls the virtualiser to the row first and focuses it once
 *     it exists, retrying for a few frames while the virtualiser renders it,
 *     and holding on for a few more in case a re-measure unmounts it again.
 *   - When the active row is scrolled out and unmounted, the container takes
 *     the Tab stop instead (`containerProps.tabIndex`) and hands focus to the
 *     row as soon as it receives it.
 *
 * Handlers live on the rows rather than on the container. A row is already an
 * interactive element, and one stable handler that reads the row's index from
 * a data attribute keeps memoised rows from re-rendering.
 *
 * @module views/contact-list/useRovingList
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** The attribute that tells the handlers which row an event came from. */
export const ROVING_INDEX_ATTR = "data-roving-index";

/** How many frames to keep trying to put focus on a row before giving up. */
const MAX_FRAMES = 60;

/**
 * How many frames focus must stay on the row before the hook lets go. The
 * virtualiser can mount a row from stale measurements and unmount it a frame
 * later once it re-measures, which drops focus to the document.
 */
const HOLD_FRAMES = 4;

export interface RovingListOptions {
  /** How many rows the list holds, mounted or not. */
  count: number;
  /**
   * The row that should own the Tab stop when the selection changes, such as
   * the contact that is open. `-1` or omitted means no selection.
   */
  selectedIndex?: number;
  /** The row's element, or null when the virtualiser has not mounted it. */
  getElement: (index: number) => HTMLElement | null;
  /** The text type-ahead matches against, usually the name. */
  getLabel: (index: number) => string;
  /** Bring the row into view. Omit for a list that is not virtualised. */
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

export interface RovingList {
  /** The row that owns the Tab stop, or -1 for an empty list. */
  activeIndex: number;
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

/** Read the row index an event came from, or null for any other element. */
function indexOf(element: EventTarget | null): number | null {
  if (!(element instanceof HTMLElement)) return null;
  const raw = element.getAttribute(ROVING_INDEX_ATTR);
  return raw === null ? null : Number(raw);
}

/** The first character a type-ahead key is compared with. */
const initialOf = (label: string) => label.trim().charAt(0).toLocaleLowerCase();

export function useRovingList(options: RovingListOptions): RovingList {
  const { count, selectedIndex = -1, isRendered } = options;
  const [storedIndex, setStoredIndex] = useState(() =>
    selectedIndex >= 0 ? selectedIndex : 0,
  );
  const activeIndex = count === 0 ? -1 : clamp(storedIndex, count);

  // The latest options and index, for handlers that must keep one identity so
  // memoised rows do not re-render on every list render.
  const optionsRef = useRef(options);
  const activeRef = useRef(activeIndex);
  useLayoutEffect(() => {
    optionsRef.current = options;
    activeRef.current = activeIndex;
  });

  // The Tab stop follows the selection: open a contact with a click or a
  // shortcut, and Tab back into the list lands on that contact.
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
        // Focus landed and is now on another control: the person moved it,
        // for example Enter opened the contact and focus went to its name.
        // Stop. Focus on the document means the row was unmounted under it,
        // so try again.
        if (landed && active && active !== document.body) return;
        held = 0;
        if (element) {
          // Both scrolls align to the nearest edge, so the browser's own
          // scroll-into-view agrees with the virtualiser's rather than
          // fighting it, and it covers a row mounted but left off screen.
          element.focus();
          landed ||= document.activeElement === element;
        } else {
          // Ask again. A list that was hidden a moment ago (a phone coming
          // back from a contact) lost its scroll position, and the virtualiser
          // measured its rows at zero height while it was hidden.
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

      // Type-ahead: one letter or digit jumps to the next name that starts
      // with it, so pressing "m" twice walks through the Ms.
      if (event.key.length !== 1 || !/[\p{L}\p{N}]/u.test(event.key)) return;
      const wanted = event.key.toLocaleLowerCase();
      for (let step = 1; step <= count; step++) {
        const candidate = (current + step) % count;
        if (initialOf(getLabel(candidate)) === wanted) return move(candidate);
      }
      // No match still consumes the key, so a letter typed into the list does
      // not fall through to a page shortcut such as "n" for a new contact.
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

  // A pointer press inside the scroller is a click on a row or on empty
  // space, never a request to jump to the active row.
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
    activeIndex,
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
