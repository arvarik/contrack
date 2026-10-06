import { useRef, useState, useEffect } from "react";

const THRESHOLD = 80;

/**
 * Read one touch gesture and refresh once. Cancelled gestures preserve
 * normal scrolling. It listens for touches only, so a mouse never pulls,
 * and it works at every width: a tablet or a phone on its side pulls too.
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let startY: number | null = null;
    let distance = 0;
    let frame: number | undefined;
    let mounted = true;
    const update = (next: number) => {
      distance = next;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setPullDistance(distance);
      });
    };
    const cancel = () => {
      startY = null;
      update(0);
    };
    const start = (event: TouchEvent) => {
      cancel();
      if (
        event.touches.length === 1 &&
        element.scrollTop <= 0 &&
        !refreshingRef.current
      )
        startY = event.touches[0].clientY;
    };
    const move = (event: TouchEvent) => {
      if (startY === null) return;
      if (event.touches.length !== 1 || element.scrollTop > 0) {
        cancel();
        return;
      }
      update(
        Math.min(Math.max(0, (event.touches[0].clientY - startY) * 0.5), 120),
      );
    };
    const end = () => {
      const shouldRefresh =
        startY !== null && distance >= THRESHOLD && !refreshingRef.current;
      cancel();
      if (!shouldRefresh) return;
      refreshingRef.current = true;
      setIsRefreshing(true);
      void Promise.resolve()
        .then(() => refreshRef.current())
        .catch(() => {
          // The query retains its error for the view's retry control.
        })
        .finally(() => {
          refreshingRef.current = false;
          if (mounted) setIsRefreshing(false);
        });
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: true });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      mounted = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
    };
  }, []);
  return {
    containerRef,
    isPulling: pullDistance > 0,
    pullProgress: Math.min(pullDistance / THRESHOLD, 1),
    isRefreshing,
    pullDistance,
  };
}
