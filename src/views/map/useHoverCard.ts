/**
 * A card that opens once the pointer rests on its pin, and closes after a
 * grace that the card can cancel, so the pointer can move into it.
 *
 * @module views/map/useHoverCard
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const OPEN_MS = 250;
export const GRACE_MS = 300;
/** A card opens at once within this long of another, so neighbours scan fast. */
const WARM_MS = 500;

export function useHoverCard<T>() {
  const [card, setCard] = useState<T | null>(null);
  const current = useRef<T | null>(null);
  const closedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Show `next` now, or close with null. */
  const set = useCallback((next: T | null) => {
    clearTimeout(timer.current);
    if (current.current && !next) closedAt.current = Date.now();
    current.current = next;
    setCard(next);
  }, []);

  const show = useCallback(
    (next: T) => {
      clearTimeout(timer.current);
      if (current.current || Date.now() - closedAt.current < WARM_MS) set(next);
      else timer.current = setTimeout(() => set(next), OPEN_MS);
    },
    [set],
  );

  /** Close after the grace, and drop an open that has not happened yet. */
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    if (current.current) timer.current = setTimeout(() => set(null), GRACE_MS);
  }, [set]);

  const keep = useCallback(() => clearTimeout(timer.current), []);

  return { card, current, set, show, hide, keep };
}
