/**
 * Whether a loading state should be on screen now. A local search answers
 * in a few milliseconds most of the time and in a few hundred on a large
 * network, and a loading state that flashes for a frame reads as a glitch:
 *
 * 1. The state shows only once the load has lasted `DELAY_MS`.
 * 2. Once shown, it stays at least `MINIMUM_MS`, so it never blinks.
 */
import { useEffect, useRef, useState } from "react";

/** How long a load runs before its state shows, in ms. */
const DELAY_MS = 150;

/** How long a shown state stays at least, in ms. */
const MINIMUM_MS = 400;

export function useLoadingShown(loading: boolean): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (loading && !shown) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (!loading && shown) {
      const left = Math.max(0, MINIMUM_MS - (Date.now() - shownAt.current));
      const timer = setTimeout(() => setShown(false), left);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [loading, shown]);

  return shown;
}
