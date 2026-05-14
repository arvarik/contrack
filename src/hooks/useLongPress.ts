/**
 * useLongPress — Cross-platform long-press gesture for mobile context menus.
 *
 * Fires `callback` after the user holds a touch for `delay` ms without moving.
 * Motion cancels the timer to prevent accidental triggers during scroll.
 * Also triggers optional haptic feedback on Android via Vibration API.
 *
 * Returns event handlers to spread onto any touchable element:
 *   const longPress = useLongPress(() => openContextMenu(), 500);
 *   <div {...longPress}>...</div>
 *
 * Notes:
 * - Uses passive touch listeners for scroll performance
 * - preventDefault() is NOT called (would break scrolling)
 * - The callback receives the touch coordinates for positioning a context menu
 * - Cleans up timer on unmount via empty-dep useEffect
 */
import React, { useRef, useCallback, useEffect } from "react";

const DEFAULT_DELAY_MS = 500;
const MOVE_THRESHOLD_PX = 10; // px of movement that cancels the press

export interface LongPressCoords {
  clientX: number;
  clientY: number;
}

export const useLongPress = (
  callback: (coords: LongPressCoords) => void,
  delay: number = DEFAULT_DELAY_MS,
) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCoordsRef = useRef<LongPressCoords | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startCoordsRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      startCoordsRef.current = {
        clientX: touch.clientX,
        clientY: touch.clientY,
      };

      timerRef.current = setTimeout(() => {
        // Haptic feedback on Android (Vibration API) — silently ignored on iOS
        if (navigator.vibrate) navigator.vibrate(50);

        const coords = startCoordsRef.current;
        if (coords) callback(coords);

        timerRef.current = null;
        startCoordsRef.current = null;
      }, delay);
    },
    [callback, delay],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startCoordsRef.current || !timerRef.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startCoordsRef.current.clientX);
      const dy = Math.abs(touch.clientY - startCoordsRef.current.clientY);
      // Cancel if the user moved significantly — they're scrolling, not pressing
      if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) {
        cancel();
      }
    },
    [cancel],
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };
};
