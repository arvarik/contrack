/**
 * Run a task once the browser has nothing better to do.
 *
 * The one caller so far warms the map's code while a person reads some other
 * page, so the first visit to the map does not start with a download. That
 * is worth doing only when it costs nothing a person would notice: after the
 * page has settled, and never on a connection whose owner asked for less
 * data.
 *
 * @module lib/idle
 */

interface IdleWindow {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

interface DataSavingNavigator {
  connection?: { saveData?: boolean };
}

/** True when this browser was told to save data. */
export function savesData(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    (navigator as Navigator & DataSavingNavigator).connection?.saveData === true
  );
}

/** How long a task waits, at most, for an idle moment that never comes. */
export const IDLE_TIMEOUT_MS = 10_000;

/** The wait in a browser with no idle callback. */
const FALLBACK_DELAY_MS = 2_000;

/**
 * Schedule `task` for an idle moment. Returns a function that cancels it.
 *
 * Does nothing at all when the browser saves data.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window === "undefined" || savesData()) return () => {};
  const idle = window as Window & IdleWindow;
  if (typeof idle.requestIdleCallback === "function") {
    const handle = idle.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => idle.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, FALLBACK_DELAY_MS);
  return () => window.clearTimeout(handle);
}
