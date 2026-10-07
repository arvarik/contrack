/**
 * Single-flight request coalescing with per-caller cancellation: concurrent
 * identical requests share one in-flight operation (an AI call, a retrieval).
 * Each caller may pass its own AbortSignal. A caller that aborts gets an
 * immediate rejection with its reason while the operation goes on for the rest;
 * when every caller has aborted, the operation's own AbortController aborts
 * too, so no provider quota is wasted.
 */

import { log } from "./logger.ts";

interface Caller {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
}

interface InFlightEntry {
  abortController: AbortController;
  callers: Set<Caller>;
  promise: Promise<unknown>;
}

export class RequestCoalescer {
  private inFlight = new Map<string, InFlightEntry>();

  /**
   * Coalesce concurrent identical executions of `action` under `key`.
   *
   * @param key Unique flight key (scoped by account, query, model, revision and
   *   so on).
   * @param action The work, run by the first caller to arrive. Its shared
   *   AbortSignal aborts only when every caller has aborted.
   * @param signal Optional caller-specific AbortSignal.
   */
  async coalesce<T>(
    key: string,
    action: (sharedSignal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw (
        signal.reason ??
        new DOMException("This operation was aborted", "AbortError")
      );
    }

    let entry = this.inFlight.get(key);

    if (!entry) {
      const abortController = new AbortController();
      const callers = new Set<Caller>();

      const entryPromise = (async () => {
        try {
          return await action(abortController.signal);
        } finally {
          if (this.inFlight.get(key) === entry) {
            this.inFlight.delete(key);
          }
        }
      })();

      entry = {
        abortController,
        callers,
        promise: entryPromise,
      };

      this.inFlight.set(key, entry);
    } else {
      log.debug(
        "Coalescer",
        `Sharing an in-flight request (${entry.callers.size + 1} waiting callers)`,
      );
    }

    const currentEntry = entry;

    return new Promise<T>((resolve, reject) => {
      const caller: Caller = {
        resolve: (val) => resolve(val as T),
        reject,
        signal,
      };
      currentEntry.callers.add(caller);

      let cleanupAbortListener: (() => void) | undefined;

      if (signal) {
        const onAbort = () => {
          cleanupAbortListener?.();
          currentEntry.callers.delete(caller);
          reject(
            signal.reason ??
              new DOMException("This operation was aborted", "AbortError"),
          );

          if (currentEntry.callers.size === 0) {
            log.debug(
              "Coalescer",
              "All callers aborted. Aborting underlying work.",
            );
            currentEntry.abortController.abort(signal.reason);
            if (this.inFlight.get(key) === currentEntry) {
              this.inFlight.delete(key);
            }
          }
        };

        signal.addEventListener("abort", onAbort, { once: true });
        cleanupAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      }

      currentEntry.promise.then(
        (value) => {
          cleanupAbortListener?.();
          currentEntry.callers.delete(caller);
          resolve(value as T);
        },
        (error) => {
          cleanupAbortListener?.();
          currentEntry.callers.delete(caller);
          reject(error);
        },
      );
    });
  }

  /** Check if a key is currently in flight. */
  has(key: string): boolean {
    return this.inFlight.has(key);
  }

  /** Clear all in-flight entries (used in test teardown). */
  clear(): void {
    for (const [, entry] of this.inFlight) {
      entry.abortController.abort(
        new DOMException("Coalescer cleared", "AbortError"),
      );
    }
    this.inFlight.clear();
  }
}
