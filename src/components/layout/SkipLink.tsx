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
import { useLocation } from "react-router-dom";

/**
 * The id the skip link falls back to. Each layout puts it on the element that
 * holds the page's own content, with `tabIndex={-1}` so it can take focus.
 */
export const MAIN_CONTENT_ID = "main-content";

/** The open contact's name, the `h1` of a contact page. */
export const CONTACT_HEADING_ID = "contact-heading";

/** The scroller that holds the contact rows. */
export const CONTACT_LIST_ID = "contact-list";

/**
 * Where "the content" is on this route.
 *
 * A single fixed target was wrong on the two busiest pages. On a wide screen
 * the Network page's main pane is "No contact selected" while the list beside
 * it is what a person came for, and on a contact page the main pane starts
 * with an avatar button and a colour picker before the name. So the link
 * follows the route: the contact's name on a contact page, the list's current
 * row on the Network page, and the main landmark everywhere else.
 */
function skipTarget(pathname: string): HTMLElement | null {
  if (/^\/(map\/)?contact\//.test(pathname)) {
    const heading = document.getElementById(CONTACT_HEADING_ID);
    if (heading) return heading;
  }
  if (pathname === "/") {
    const list = document.getElementById(CONTACT_LIST_ID);
    // The row that owns the list's Tab stop, or the list itself while that
    // row is scrolled out of the virtualised range.
    const row =
      list?.querySelector<HTMLElement>('[tabindex="0"]') ??
      (list?.getAttribute("tabindex") === "0" ? list : null);
    if (row) return row;
  }
  return document.getElementById(MAIN_CONTENT_ID);
}

export const SkipLink = () => {
  const { pathname } = useLocation();
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={(event) => {
        event.preventDefault();
        skipTarget(pathname)?.focus({ preventScroll: false });
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[300] focus:px-4 focus:py-2.5 focus:rounded-xl focus:bg-primary focus:text-on-primary focus:text-sm focus:font-bold focus:shadow-lg"
    >
      Skip to main content
    </a>
  );
};
