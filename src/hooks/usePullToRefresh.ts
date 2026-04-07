/**
 * usePullToRefresh — Mobile pull-to-refresh gesture handler.
 *
 * Attaches touch listeners to a scroll container. When the user pulls down
 * beyond a threshold while at the top of the scroll, calls `onRefresh`.
 *
 * Design:
 * - Only activates when scrollTop === 0
 * - Uses resistance factor so the pull gets harder near the threshold
 * - Does NOT interfere with normal vertical scrolling
 * - `disabled` flag lets callers opt out on desktop (where pull-to-refresh is irrelevant)
 *
 * @example
 *   const { containerRef, isPulling, pullProgress, isRefreshing, pullDistance } = usePullToRefresh(refetch);
 *   <div ref={containerRef}>
 *     <PullIndicator isPulling={isPulling} isRefreshing={isRefreshing} progress={pullProgress} pullDistance={pullDistance} />
 *     ...content...
 *   </div>
 */
import { useRef, useState, useCallback, useEffect } from 'react';

const PULL_THRESHOLD = 80; // px to trigger refresh
const MAX_PULL = 120;      // max visual pull distance

interface UsePullToRefreshOptions {
  disabled?: boolean;
}

export const usePullToRefresh = (
  onRefresh: () => Promise<void> | void,
  options: UsePullToRefreshOptions = {}
) => {
  const { disabled = false } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isPulling = pullDistance > 0;
  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);

  const triggerRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPullDistance(0);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop === 0) {
        startYRef.current = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || isRefreshing) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy > 0 && el.scrollTop === 0) {
        // Apply resistance so pulling far requires more force
        const clamped = Math.min(dy * 0.5, MAX_PULL);
        setPullDistance(clamped);
      }
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      if (pullDistance >= PULL_THRESHOLD) {
        triggerRefresh();
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [disabled, isRefreshing, pullDistance, triggerRefresh]);

  return { containerRef, isPulling, pullProgress, isRefreshing, pullDistance };
};
