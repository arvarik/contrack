/**
 * useLoadingShown: whether a loading state should be on screen now.
 *
 * A search over local notes answers in a few milliseconds most of the time,
 * and in a few hundred on a large network or a slow disk. A loading state
 * drawn for every answer flashes for one frame on the fast ones, which
 * reads as a glitch, and one that vanishes the instant it appears reads as
 * a glitch too. So:
 *
 * 1. The state shows only once the load has lasted `delay` ms. A fast
 *    answer never shows it.
 * 2. Once shown, it stays at least `minimum` ms, so a slow answer shows it
 *    for long enough to be read, and never blinks.
 *
 * With both at 0 the result follows `loading`, one task behind it.
 *
 * @module hooks/useLoadingShown
 */
import { useEffect, useRef, useState } from "react";

export interface LoadingShownOptions {
  /** How long a load runs before its state shows, in ms. Default 150. */
  delay?: number;
  /** How long a shown state stays at least, in ms. Default 400. */
  minimum?: number;
}

export function useLoadingShown(
  loading: boolean,
  { delay = 150, minimum = 400 }: LoadingShownOptions = {},
): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (loading && !shown) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (!loading && shown) {
      const left = Math.max(0, minimum - (Date.now() - shownAt.current));
      const timer = setTimeout(() => setShown(false), left);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [loading, shown, delay, minimum]);

  return shown;
}
