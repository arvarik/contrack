import { AppError } from "../utils/AppError.ts";

/** Bound concurrent provider calls and remove cancelled work before it starts. */
export class GenerationQueue {
  private active = 0;
  private waiting: Array<{ start: () => void; cancel: () => void }> = [];

  constructor(
    private readonly concurrency = 2,
    private readonly capacity = 16,
  ) {}

  run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency && this.waiting.length >= this.capacity)
      return Promise.reject(
        new AppError("AI is busy. Please try again shortly.", 429, {
          code: "AI_BUSY",
        }),
      );
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", job.cancel);
      const job = {
        cancel: () => {
          this.waiting = this.waiting.filter((entry) => entry !== job);
          cleanup();
          reject(signal.reason);
        },
        start: () => {
          cleanup();
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          this.active++;
          Promise.resolve()
            .then(() => {
              signal.throwIfAborted();
              return operation();
            })
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.waiting.shift()?.start();
            });
        },
      };
      if (this.active < this.concurrency) job.start();
      else {
        this.waiting.push(job);
        signal.addEventListener("abort", job.cancel, { once: true });
      }
    });
  }
}

/** Share identical work. One caller cannot cancel work another caller still needs. */
export class SharedWork<T> {
  private entries = new Map<
    string,
    { controller: AbortController; promise: Promise<T>; users: number }
  >();

  async run(
    key: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created = {
        controller,
        users: 0,
        promise: Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return operation(controller.signal);
        }),
      };
      entry = created;
      this.entries.set(key, created);
      const remove = () => {
        if (this.entries.get(key) === created) this.entries.delete(key);
      };
      created.promise.then(remove, remove);
    }
    const current = entry;
    current.users++;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([current.promise, cancelled]);
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      current.users--;
      if (current.users === 0) {
        current.controller.abort();
        if (this.entries.get(key) === current) this.entries.delete(key);
      }
    }
  }
}
