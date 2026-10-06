/**
 * Run a task once the browser has nothing better to do, such as warming a
 * page's code before a person visits it. Never when the browser was asked
 * to save data.
 */

interface IdleWindow {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

interface DataSavingNavigator {
  connection?: { saveData?: boolean; effectiveType?: string };
}

/** The connection, as the Network Information API reports it. */
function connection(): DataSavingNavigator["connection"] {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & DataSavingNavigator).connection;
}

/** True when this browser was told to save data. */
function savesData(): boolean {
  return connection()?.saveData === true;
}

/**
 * True on a connection the browser rates "4g" when nobody asked it to save
 * data, because warming the map, Pulse and Ask (about 1 MB) costs a slow
 * phone the bandwidth its first page needs. A browser with no Network
 * Information API (Safari, Firefox) counts as fast with a mouse, which
 * means a desktop, and as slow without.
 */
export function onFastConnection(): boolean {
  const info = connection();
  if (info) return info.effectiveType === "4g" && info.saveData !== true;
  return globalThis.matchMedia?.("(pointer: fine)").matches === true;
}

/** How long a task waits, at most, for an idle moment that never comes. */
const IDLE_TIMEOUT_MS = 10_000;

/** The wait in a browser with no idle callback. */
const FALLBACK_DELAY_MS = 2_000;

/**
 * Schedule `task` for an idle moment, and return a function that cancels
 * it. Does nothing when the browser saves data.
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
