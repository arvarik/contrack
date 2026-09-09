import { describe, it, expect, vi } from "vitest";
import { GenerationQueue, SharedWork } from "../../server/ai/workQueue.ts";
import { QuotaTracker } from "../../server/ai/routing/QuotaTracker.ts";
import { withRetry } from "../../server/ai/resilience.ts";
import { AppError } from "../../server/utils/AppError.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AI work limits", () => {
  it("bounds active work and rejects excess queued requests", async () => {
    const queue = new GenerationQueue(1, 1);
    const first = deferred<string>();
    const second = vi.fn(async () => "second");
    const signal = new AbortController().signal;
    const one = queue.run(() => first.promise, signal);
    const two = queue.run(second, signal);
    await expect(queue.run(async () => "excess", signal)).rejects.toMatchObject(
      { statusCode: 429 },
    );
    expect(second).not.toHaveBeenCalled();
    first.resolve("first");
    expect(await one).toBe("first");
    expect(await two).toBe("second");
  });
  it("removes a cancelled queued request without starting it", async () => {
    const queue = new GenerationQueue(1);
    const first = deferred<void>();
    const controller = new AbortController();
    const one = queue.run(() => first.promise, new AbortController().signal);
    const operation = vi.fn(async () => "unused");
    const two = queue.run(operation, controller.signal).catch((error) => error);
    controller.abort();
    expect((await two).name).toBe("AbortError");
    first.resolve();
    await one;
    expect(operation).not.toHaveBeenCalled();
  });
  it("does not start work cancelled before its first microtask", async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => 1);
    const result = new GenerationQueue().run(operation, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
  it("shares identical work while each caller retains separate cancellation", async () => {
    const shared = new SharedWork<number>();
    const pending = deferred<number>();
    let sharedSignal!: AbortSignal;
    const operation = vi.fn((signal: AbortSignal) => {
      sharedSignal = signal;
      return pending.promise;
    });
    const controller = new AbortController();
    const one = shared
      .run("same", operation, controller.signal)
      .catch((error) => error);
    const two = shared.run("same", operation);
    await Promise.resolve();
    controller.abort();
    await one;
    expect(sharedSignal.aborted).toBe(false);
    pending.resolve(2);
    expect(await two).toBe(2);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("cancels shared work when its final caller leaves", async () => {
    const shared = new SharedWork<number>();
    const controller = new AbortController();
    let sharedSignal!: AbortSignal;
    const pending = deferred<number>();
    const result = shared
      .run(
        "one",
        (signal) => {
          sharedSignal = signal;
          return pending.promise;
        },
        controller.signal,
      )
      .catch((error) => error);
    await Promise.resolve();
    controller.abort();
    await result;
    expect(sharedSignal.aborted).toBe(true);
    pending.resolve(1);
  });
  it("never retries malformed output or authentication failures", async () => {
    const invalid = vi
      .fn()
      .mockRejectedValue(
        new AppError("invalid JSON", 502, { code: "AI_INVALID_JSON" }),
      );
    await expect(withRetry(invalid)).rejects.toThrow("invalid JSON");
    expect(invalid).toHaveBeenCalledTimes(1);
    const unauthorized = vi.fn().mockRejectedValue({
      status: 401,
      message: "quota unavailable for this key",
    });
    await expect(withRetry(unauthorized)).rejects.toThrow();
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent quota reservations", () => {
  it("reconciles and rolls back the correct request when completions arrive out of order", () => {
    const tracker = new QuotaTracker();
    const first = tracker.reserve("same", 100);
    const second = tracker.reserve("same", 200);
    tracker.reconcile("same", 100, 40, first);
    expect(tracker.getSnapshot().models.same.tpm).toBe(240);
    tracker.rollback("same", second);
    expect(tracker.getSnapshot().models.same).toEqual({
      tpm: 40,
      rpm: 1,
      rpd: 1,
    });
    tracker.rollback("same", second);
    expect(tracker.getSnapshot().models.same.rpd).toBe(1);
  });
  it.each([
    ["2026-09-09T06:59:00Z", "2026-09-09T07:01:00Z"],
    ["2026-12-09T07:59:00Z", "2026-12-09T08:01:00Z"],
  ])("resets daily quotas at Pacific midnight from %s", (before, after) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(before));
      const tracker = new QuotaTracker(2);
      tracker.reserve("same", 100);
      tracker.reserveGrounding();
      vi.setSystemTime(new Date(after));
      const snapshot = tracker.getSnapshot();
      expect(snapshot.models.same).toEqual({ rpm: 0, tpm: 0, rpd: 0 });
      expect(snapshot.grounding.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the quota at UTC midnight and preserves new-day usage after an old rejection", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
      const tracker = new QuotaTracker(2);
      const oldRequest = tracker.reserve("same", 100);
      const oldGroundingDate = tracker.reserveGrounding();
      vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
      expect(tracker.getSnapshot().models.same.rpd).toBe(1);
      expect(tracker.getSnapshot().grounding.rpd).toBe(1);
      vi.setSystemTime(new Date("2026-09-09T07:01:00Z"));
      tracker.reserve("same", 50);
      tracker.reserveGrounding();
      tracker.rollback("same", oldRequest);
      tracker.rollbackGrounding(oldGroundingDate);
      expect(tracker.getSnapshot().models.same.rpd).toBe(1);
      expect(tracker.getSnapshot().grounding.rpd).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
