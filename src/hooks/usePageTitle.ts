/**
 * usePageTitle — Declarative document.title management.
 *
 * Sets `document.title` on mount and restores it on unmount.
 * Multiple components can call this; the most recently mounted wins
 * (standard Last-Writer-Wins for sibling views).
 *
 * @example
 *   usePageTitle(contact?.name)        // → "Alex Chen — Contrack"
 *   usePageTitle('Settings')           // → "Settings — Contrack"
 *   usePageTitle(null)                 // → "Contrack" (fallback)
 */
import { useEffect } from 'react';

const APP_NAME = 'Contrack';

export const usePageTitle = (title: string | null | undefined) => {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = previous;
    };
  }, [title]);
};
