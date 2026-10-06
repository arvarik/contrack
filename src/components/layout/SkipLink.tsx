/**
 * The first Tab stop on every page (WCAG 2.4.1), past the sidebar and the
 * tab bar. Hidden until it has focus, then in the top-left corner.
 *
 * It moves focus itself: a fragment navigation would add `#main-content` to
 * the history, and Back would seem to do nothing.
 */
import { useLocation } from "react-router-dom";

/**
 * The id the skip link falls back to. Each layout puts it on the element that
 * holds the page's own content, with `tabIndex={-1}` so it can take focus.
 */
export const MAIN_CONTENT_ID = "main-content";

/** The open contact's name, the `h1` of a contact page. */
export const CONTACT_HEADING_ID = "contact-heading";

/** The Settings page beside the rail: its header and its body. */
export const SETTINGS_CONTENT_ID = "settings-content";

/** The scroller that holds the contact rows. */
const CONTACT_LIST_ID = "contact-list";

/**
 * Where "the content" is on this route: the contact's name on a contact
 * page, the list's current row on the Network page, the page beside the rail
 * in Settings, and the main landmark elsewhere.
 */
function skipTarget(pathname: string): HTMLElement | null {
  if (/^\/(map\/)?contact\//.test(pathname)) {
    const heading = document.getElementById(CONTACT_HEADING_ID);
    if (heading) return heading;
  }
  if (pathname === "/") {
    const list = document.getElementById(CONTACT_LIST_ID);
    // The row that owns the list's Tab stop, or the list itself while that
    // row is scrolled out of the virtualized range.
    const row =
      list?.querySelector<HTMLElement>('[tabindex="0"]') ??
      (list?.getAttribute("tabindex") === "0" ? list : null);
    if (row) return row;
  }
  // Past the Settings rail, which holds every page's link.
  if (pathname.startsWith("/settings")) {
    const page = document.getElementById(SETTINGS_CONTENT_ID);
    if (page) return page;
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
