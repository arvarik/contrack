/**
 * Sets `document.title` on mount and restores it on unmount. The most
 * recently mounted caller wins. The brand leads, because a browser truncates
 * a title to its first couple of words.
 *
 * @example
 *   usePageTitle(contact?.name)        // → "Contrack - Rowan Vale"
 *   usePageTitle('Settings')           // → "Contrack - Settings"
 *   usePageTitle(null)                 // → "Contrack" (fallback)
 */
import { useEffect } from "react";
import { useAuth } from "../components/auth/AuthGate";

const APP_NAME = "Contrack";

export const usePageTitle = (title: string | null | undefined) => {
  // The instance's own name replaces the product name when there is one. Two
  // Contrack tabs from two instances are otherwise the same word twice, and a
  // browser truncates a title to roughly its first two words, so the part
  // that distinguishes them has to be the part that survives.
  const { instanceName } = useAuth();
  const brand = instanceName || APP_NAME;

  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${brand} - ${title}` : brand;
    return () => {
      document.title = previous;
    };
  }, [title, brand]);
};
