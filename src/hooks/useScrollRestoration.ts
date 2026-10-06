import { useRef, useLayoutEffect } from "react";

const storageKeyFor = (key: string) => `contrack_scroll_${key}`;
const anchorKeyFor = (key: string) => `contrack_scroll_anchor_${key}`;

/**
 * The attribute that names a row, so a place is kept by row and not only
 * by pixel. Its value is the row's id.
 */
export const SCROLL_ANCHOR_ATTR = "data-scroll-anchor";

/** The row at the top of the view, and how far its top sits from the top. */
interface ScrollAnchor {
  id: string;
  /** In px. Zero or less: the row starts at the top or above it. */
  offset: number;
}

/**
 * The position saved for the view `key`, or 0. A virtual list passes it to
 * its virtualizer as the first offset. The hook below restores the scroller
 * before paint, but a virtualizer that starts at 0 draws its rows at the top
 * while the scroller shows the saved place, so the first frame is empty.
 */
export function savedScroll(key: string): number {
  try {
    const saved = Number(sessionStorage.getItem(storageKeyFor(key)));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch {
    /* Storage can be disabled. */
  }
  return 0;
}

/**
 * The row at the top of the scroller, when the top shows a row. Null when
 * the top shows what sits above the rows.
 */
function findAnchor(scroller: HTMLElement): ScrollAnchor | null {
  const top = scroller.getBoundingClientRect().top;
  for (const row of scroller.querySelectorAll(`[${SCROLL_ANCHOR_ATTR}]`)) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= top) continue;
    const offset = rect.top - top;
    const id = row.getAttribute(SCROLL_ANCHOR_ATTR);
    return id && offset <= 0 ? { id, offset } : null;
  }
  return null;
}

function readAnchor(key: string): ScrollAnchor | null {
  try {
    const raw = sessionStorage.getItem(anchorKeyFor(key));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      typeof parsed === "object" &&
      "id" in parsed &&
      "offset" in parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.offset === "number"
    )
      return { id: parsed.id, offset: parsed.offset };
  } catch {
    /* Storage can be disabled, and a value can be damaged. */
  }
  return null;
}

/**
 * Puts the row saved for `key` back where it was in the view: the same row,
 * the same distance from the top. A pixel offset is not enough: the Recent
 * strip above the rows grows when a contact opens, and a virtual list places
 * its rows from estimates until it measures them, so the same pixel can show
 * other people. Returns false when nothing was saved, or the row is not
 * drawn.
 */
export function restoreScrollAnchor(scroller: HTMLElement, key: string) {
  const anchor = readAnchor(key);
  if (!anchor || scroller.clientHeight === 0) return false;
  const row = scroller.querySelector(
    `[${SCROLL_ANCHOR_ATTR}="${CSS.escape(anchor.id)}"]`,
  );
  if (!row) return false;
  const top =
    row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += top - anchor.offset;
  return true;
}

/**
 * Restore a container after its data loads. Storage failures never interrupt
 * navigation.
 *
 * 1. A scroll, and a press that may open a row, save the pixel offset and,
 *    when the top of the view shows a row with `data-scroll-anchor`, that
 *    row and its offset.
 * 2. When the data is ready, the pixel offset comes back before paint. Then
 *    the saved row goes back to its place, at once and on the next two
 *    frames, after a virtual list has measured its rows.
 * 3. A hidden container saves nothing: every position in it reads 0.
 */
export function useScrollRestoration<T extends HTMLElement = HTMLDivElement>(
  key: string,
  ready = true,
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    const storageKey = storageKeyFor(key);
    element.scrollTop = savedScroll(key);
    restoreScrollAnchor(element, key);
    let frame = requestAnimationFrame(() => {
      restoreScrollAnchor(element, key);
      frame = requestAnimationFrame(() => restoreScrollAnchor(element, key));
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (element.clientHeight === 0) return;
      try {
        sessionStorage.setItem(storageKey, String(element.scrollTop));
        const anchor = findAnchor(element);
        if (anchor)
          sessionStorage.setItem(anchorKeyFor(key), JSON.stringify(anchor));
        else sessionStorage.removeItem(anchorKeyFor(key));
      } catch {
        /* Scrolling also works without storage. */
      }
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 150);
    };
    // A tap that opens a row can come before the scroll's save: the list
    // then leaves the screen, and a hidden list saves nothing.
    const onPress = () => {
      clearTimeout(timer);
      save();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("pointerdown", onPress, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("pointerdown", onPress);
      clearTimeout(timer);
      save();
    };
  }, [key, ready]);
  return ref;
}
