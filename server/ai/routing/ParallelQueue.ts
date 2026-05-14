// =============================================================================
// AI Layer — Parallel Concurrency Queue
// =============================================================================
// A standalone utility for processing arrays of items with strict concurrency
// limits. This is NOT coupled to the routing layer — it's a general-purpose
// worker pool that any consumer can use.
//
// Why not Promise.all()?
//   Promise.all(items.map(fn)) fires ALL items simultaneously.
//   50 items → 50 TCP connections → guaranteed 429 burst from Google.
//
// ParallelQueue enforces a worker pool pattern: exactly N workers process
// items from a shared queue. When a worker finishes one item, it picks
// up the next. Individual failures are isolated — one bad item never
// takes down the entire batch.
// =============================================================================

export class ParallelQueue {
  /**
   * Process an array of items with strict concurrency control.
   *
   * Spawns at most `concurrencyLimit` workers that pull items from
   * a shared queue. Each worker processes items sequentially until
   * the queue is empty.
   *
   * Individual errors are captured as Error objects in the result array
   * rather than rejecting the entire batch.
   *
   * @param items            - The items to process
   * @param concurrencyLimit - Maximum number of items in-flight simultaneously
   * @param taskFn           - Async function to process each item
   * @returns                - Array of results (or Error for failed items),
   *                           in the same order as the input array
   *
   * @example
   * const results = await ParallelQueue.process(contacts, 5, async (contact) => {
   *   return ai.generate({ prompt: contact.text, ... });
   * });
   * const successes = results.filter(r => !(r instanceof Error));
   * const failures = results.filter(r => r instanceof Error);
   */
  static async process<T, R>(
    items: T[],
    concurrencyLimit: number,
    taskFn: (item: T, index: number) => Promise<R>,
  ): Promise<(R | Error)[]> {
    const results: (R | Error)[] = new Array(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        try {
          results[currentIndex] = await taskFn(
            items[currentIndex],
            currentIndex,
          );
        } catch (error: unknown) {
          // Isolate failures: one bad item doesn't crash the batch
          results[currentIndex] =
            error instanceof Error ? error : new Error(String(error));
        }
      }
    };

    // Spawn workers up to the lesser of concurrency limit and item count
    const workerCount = Math.min(concurrencyLimit, items.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results;
  }
}
