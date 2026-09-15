/**
 * SkipLink — the first Tab stop on every page.
 *
 * WCAG 2.4.1 (Bypass Blocks). The sidebar is six stops and the mobile tab
 * bar five, and a keyboard user paid them on every page before this. The
 * link is visually hidden until it has focus, so a pointer user never sees
 * it, and it appears in the top-left corner over everything else the moment
 * Tab reaches it.
 *
 * It moves focus itself rather than leaving the fragment to the browser. A
 * fragment navigation writes `#main-content` into the address bar and the
 * history, so Back would return to the same page with the hash removed,
 * which reads as a navigation that did nothing. Focusing the element
 * directly does the one thing the link promises and nothing else.
 */
import React from "react";

/**
 * The id the skip link targets. Each layout puts it on the element that
 * holds the page's own content, with `tabIndex={-1}` so it can take focus.
 */
export const MAIN_CONTENT_ID = "main-content";

export const SkipLink = () => (
  <a
    href={`#${MAIN_CONTENT_ID}`}
    onClick={(event) => {
      event.preventDefault();
      document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: false });
    }}
    className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[300] focus:px-4 focus:py-2.5 focus:rounded-xl focus:bg-primary focus:text-on-primary focus:text-sm focus:font-bold focus:shadow-lg"
  >
    Skip to main content
  </a>
);
