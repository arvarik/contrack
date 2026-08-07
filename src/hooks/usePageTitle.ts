/**
 * usePageTitle — Declarative document.title management.
 *
 * Sets `document.title` on mount and restores it on unmount.
 * Multiple components can call this; the most recently mounted wins
 * (standard Last-Writer-Wins for sibling views).
 *
 * Brand first: with a dozen tabs open the title is truncated to its first
 * couple of words, so the app name has to lead or every Contrack tab is
 * indistinguishable from every other one.
 *
 * @example
 *   usePageTitle(contact?.name)        // → "Contrack - Alex Chen"
 *   usePageTitle('Settings')           // → "Contrack - Settings"
 *   usePageTitle(null)                 // → "Contrack" (fallback)
 */
import { useEffect } from "react";

const APP_NAME = "Contrack";

export const usePageTitle = (title: string | null | undefined) => {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${APP_NAME} - ${title}` : APP_NAME;
    return () => {
      document.title = previous;
    };
  }, [title]);
};
