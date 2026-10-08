/**
 * Run a task once the browser has nothing better to do, such as warming a
 * page's code before a person visits it. Never when the browser was asked
 * to save data, and not while an API request is on its way.
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

/** How long a task waits, at most, for the API requests to finish. */
const BUSY_WAIT_MS = 10_000;

/** How often a waiting task looks again. */
const BUSY_RETRY_MS = 250;

/** API requests on their way, bodies included (`noteRequest`). */
let requestsInFlight = 0;

/**
 * Counts `request` until it settles, so idle work waits for it: on a slow
 * phone the map's code took the bandwidth the first contact list needed.
 */
export function noteRequest<T>(request: Promise<T>): Promise<T> {
  requestsInFlight += 1;
  const settle = () => {
    requestsInFlight -= 1;
  };
  request.then(settle, settle);
  return request;
}

/**
 * Schedule `task` for an idle moment, and return a function that cancels
 * it. Does nothing when the browser saves data. After the idle moment the
 * task waits while an API request is on its way, looking every
 * `BUSY_RETRY_MS`, for `BUSY_WAIT_MS` at most, so a request that streams
 * for long does not hold it forever.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window === "undefined" || savesData()) return () => {};
  const idle = window as Window & IdleWindow;
  const giveUpAt = Date.now() + BUSY_WAIT_MS;
  let cancel = () => {};
  const afterRequests = () => {
    if (requestsInFlight === 0 || Date.now() >= giveUpAt) return task();
    const handle = window.setTimeout(afterRequests, BUSY_RETRY_MS);
    cancel = () => window.clearTimeout(handle);
  };
  if (typeof idle.requestIdleCallback === "function") {
    const handle = idle.requestIdleCallback(afterRequests, {
      timeout: IDLE_TIMEOUT_MS,
    });
    cancel = () => idle.cancelIdleCallback?.(handle);
  } else {
    const handle = window.setTimeout(afterRequests, FALLBACK_DELAY_MS);
    cancel = () => window.clearTimeout(handle);
  }
  return () => cancel();
}
