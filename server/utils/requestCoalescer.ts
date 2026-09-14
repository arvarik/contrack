/**
 * requestCoalescer.ts — Single-flight request coalescing with caller-level cancellation.
 *
 * Implements the single-flight pattern: concurrent identical requests share
 * a single in-flight operation rather than repeating expensive work
 * (e.g., AI provider LLM calls or semantic retrieval).
 *
 * Cancellation preservation:
 * - Each waiting caller may supply its own AbortSignal.
 * - If one caller aborts, its promise rejects immediately with the abort reason.
 *   The underlying operation CONTINUES running for remaining callers.
 * - If ALL waiting callers abort, the underlying operation's AbortController
 *   is aborted, cancelling downstream provider work and preventing wasted quota.
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
   * @param key Unique cache/flight key (e.g., scoped by account, query, model, revision).
   * @param action The work function to run if this caller is the first to arrive.
   *               Receives a shared AbortSignal that only aborts when ALL callers abort.
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
        `Sharing in-flight request for key "${key.slice(0, 60)}" (${entry.callers.size + 1} waiting callers)`,
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
              `All callers aborted for key "${key.slice(0, 60)}". Aborting underlying work.`,
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

  /** Number of operations currently in flight. */
  inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Number of callers currently waiting for a given key. */
  callersCount(key: string): number {
    return this.inFlight.get(key)?.callers.size ?? 0;
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
