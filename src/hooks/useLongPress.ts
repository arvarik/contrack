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
 *
 * What the finger does after the press belongs to the press:
 *
 * 1. The lift sends a click. It goes to whatever is under the finger then,
 *    which is not always the element pressed: a press that starts select
 *    mode can move the rows. So the next click anywhere in the page is
 *    swallowed (`swallowNextClick`). A new touch, or a short wait after the
 *    lift, ends the wait, so a later tap is never lost.
 * 2. Android answers a long press with `contextmenu`, and iOS with its own
 *    link preview. The press is the touch's menu, so a `contextmenu` from a
 *    touch is refused here (`onContextMenuCapture`): the desktop menu and
 *    the browser's menu stay shut. A right click and the menu key still
 *    open it. The element sets `-webkit-touch-callout: none` for iOS.
 */
import React, { useRef, useCallback, useEffect } from "react";

const DEFAULT_DELAY_MS = 500;
const MOVE_THRESHOLD_PX = 10; // px of movement that cancels the press

/** How long after the lift a click still counts as the press's own. */
const LIFT_CLICK_MS = 400;

/** The longest the swallow waits for a lift that never comes. */
const MAX_WAIT_MS = 5_000;

/**
 * How long after a touch a `contextmenu` is the touch's. Android sends it
 * while the finger is still down, and a browser can send it just after.
 */
const TOUCH_MENU_MS = 800;

interface LongPressCoords {
  clientX: number;
  clientY: number;
}

/**
 * Swallows the next click in the page, in the capture phase, before any
 * handler sees it. Returns a function that stops the wait `ms` from now.
 */
function swallowNextClick(): (ms: number) => void {
  let timer = window.setTimeout(() => disarm(), MAX_WAIT_MS);
  const swallow = (event: MouseEvent) => {
    // Only a click a finger made. A screen reader's double tap, a switch, or
    // a click from code sends no touch pointer, and must go through.
    const pointer = (event as PointerEvent).pointerType;
    if (pointer !== undefined && pointer !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    disarm();
  };
  function disarm() {
    window.clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("touchstart", disarm, true);
  }
  window.addEventListener("click", swallow, true);
  // A new touch means the lift sent no click: Android sends none after a
  // long press that it answered with `contextmenu`.
  window.addEventListener("touchstart", disarm, true);
  return (ms) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(disarm, ms);
  };
}

export const useLongPress = (
  callback: (coords: LongPressCoords) => void,
  delay: number = DEFAULT_DELAY_MS,
) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCoordsRef = useRef<LongPressCoords | null>(null);
  /** Ends the click swallow once the finger lifts, after a press fired. */
  const endSwallow = useRef<((ms: number) => void) | null>(null);
  /** True while a finger is down on the element. */
  const touching = useRef(false);
  /** When a finger last touched the element or left it. */
  const lastTouch = useRef(0);

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
      cancel();
      touching.current = true;
      lastTouch.current = Date.now();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startCoordsRef.current = {
        clientX: touch.clientX,
        clientY: touch.clientY,
      };

      timerRef.current = setTimeout(() => {
        // Haptic feedback on Android (Vibration API) — silently ignored on iOS
        if (navigator.vibrate) navigator.vibrate(50);

        const coords = startCoordsRef.current;
        if (coords) {
          endSwallow.current = swallowNextClick();
          callback(coords);
        }

        timerRef.current = null;
        startCoordsRef.current = null;
      }, delay);
    },
    [callback, delay, cancel],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startCoordsRef.current || !timerRef.current) return;
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
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

  const onTouchEnd = useCallback(() => {
    cancel();
    touching.current = false;
    lastTouch.current = Date.now();
    endSwallow.current?.(LIFT_CLICK_MS);
    endSwallow.current = null;
  }, [cancel]);

  const onContextMenuCapture = useCallback((event: React.MouseEvent) => {
    const pointer = (event.nativeEvent as Partial<PointerEvent>).pointerType;
    const byTouch =
      pointer === "touch" ||
      touching.current ||
      Date.now() - lastTouch.current < TOUCH_MENU_MS;
    if (!byTouch) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    onContextMenuCapture,
  };
};
