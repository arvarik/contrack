// =============================================================================
// Unit Tests — AI Resilience Primitives (Phase 2)
// =============================================================================
// Covers the shared utilities every AI adapter is built on:
//   - withTimeout          → bounds a single attempt, surfaces UpstreamTimeoutError
//   - withRetry            → jittered exponential-backoff with abort propagation
//   - isRetryableError     → coarse classifier for transient upstream failures
//   - parseAIJson          → tolerant JSON parsing for model output
//
// These tests use vitest fake timers heavily because the production code
// schedules real backoffs (500ms, 1000ms, 2000ms). We never sleep in real time.
// All async paths must therefore co-operate with `vi.advanceTimersByTimeAsync`.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  AI_DEFAULTS,
  isRetryableError,
  parseAIJson,
  withRetry,
  withTimeout,
} from "../../server/ai/resilience.ts";
import {
  AppError,
  RateLimitedError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
} from "../../server/utils/AppError.ts";

// =============================================================================
// isRetryableError
// =============================================================================

describe("isRetryableError", () => {
  it("returns true for HTTP 429 (rate limit)", () => {
    expect(isRetryableError({ status: 429 }, false)).toBe(true);
    expect(isRetryableError({ statusCode: 429 }, false)).toBe(true);
  });

  it("returns true for HTTP 408 (request timeout)", () => {
    expect(isRetryableError({ status: 408 }, false)).toBe(true);
  });

  it("returns true for the entire 5xx range", () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(isRetryableError({ status }, false)).toBe(true);
    }
  });

  it("returns false for 4xx other than 408/429", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableError({ status }, false)).toBe(false);
    }
  });

  it("recognizes connection-level error codes", () => {
    expect(isRetryableError({ code: "ECONNRESET" }, false)).toBe(true);
    expect(isRetryableError({ code: "ECONNREFUSED" }, false)).toBe(true);
    expect(isRetryableError({ code: "ETIMEDOUT" }, false)).toBe(true);
    expect(isRetryableError({ code: "EAI_AGAIN" }, false)).toBe(true);
  });

  it("matches transient keywords in error messages", () => {
    expect(isRetryableError({ message: "rate limit reached" }, false)).toBe(
      true,
    );
    expect(isRetryableError({ message: "Quota exceeded" }, false)).toBe(true);
    expect(isRetryableError({ message: "Resource exhausted." }, false)).toBe(
      true,
    );
    expect(
      isRetryableError({ message: "Model overloaded, please retry" }, false),
    ).toBe(true);
    expect(
      isRetryableError({ message: "Temporarily unavailable" }, false),
    ).toBe(true);
    expect(isRetryableError({ message: "Deadline exceeded" }, false)).toBe(
      true,
    );
    expect(isRetryableError({ message: "Request timeout" }, false)).toBe(true);
  });

  it("does NOT classify permanent client errors as retryable", () => {
    expect(isRetryableError({ message: "Invalid API key" }, false)).toBe(false);
    expect(
      isRetryableError({ message: "Schema validation failed" }, false),
    ).toBe(false);
    expect(
      isRetryableError({ message: "Content blocked by safety filter" }, false),
    ).toBe(false);
  });

  it("treats `abortedByTimeout=true` as retryable regardless of error shape", () => {
    expect(isRetryableError(new Error("Aborted"), true)).toBe(true);
    expect(isRetryableError({ message: "anything at all" }, true)).toBe(true);
  });

  it("tolerates null / undefined / non-object errors", () => {
    expect(isRetryableError(null, false)).toBe(false);
    expect(isRetryableError(undefined, false)).toBe(false);
    expect(isRetryableError("plain string error", false)).toBe(false);
  });
});

// =============================================================================
// withTimeout
// =============================================================================

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the op's value when it finishes within the deadline", async () => {
    const op = vi.fn(async () => "ok");
    const promise = withTimeout(op, 1_000);
    await expect(promise).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("throws UpstreamTimeoutError when the op exceeds the deadline", async () => {
    const op = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Aborted")));
      });

    const captured = withTimeout(op, 100).catch((e) => e);
    // Drive the timer past the deadline so the AbortController fires.
    await vi.advanceTimersByTimeAsync(150);
    const err = await captured;
    expect(err).toBeInstanceOf(UpstreamTimeoutError);
    expect(err).toMatchObject({ statusCode: 504, code: "UPSTREAM_TIMEOUT" });
  });

  it("passes its own signal to the op so abort can short-circuit it", async () => {
    let receivedSignal: AbortSignal | null = null;
    const op = async (signal: AbortSignal) => {
      receivedSignal = signal;
      return "fast";
    };
    await withTimeout(op, 1_000);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("propagates parent-signal aborts and never throws as timeout", async () => {
    const parentCtl = new AbortController();
    const op = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Aborted")));
      });

    const promise = withTimeout(op, 5_000, parentCtl.signal);
    // Caller cancels before the timer fires.
    parentCtl.abort();
    // The rejection should NOT be classified as a timeout.
    await expect(promise).rejects.not.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("returns the op's success immediately if parentSignal is already aborted but op resolves synchronously", async () => {
    // Edge case: parentSignal is aborted before withTimeout is called.
    // The implementation calls controller.abort() inside but doesn't reject
    // — the op is still invoked. We only fail if the op itself rejects.
    const parentCtl = new AbortController();
    parentCtl.abort();
    const op = async () => "still ok";
    await expect(withTimeout(op, 1_000, parentCtl.signal)).resolves.toBe(
      "still ok",
    );
  });
});

// =============================================================================
// withRetry
// =============================================================================

describe("withRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the op's result without retrying on success", async () => {
    const op = vi.fn(async () => "first-try");
    const result = await withRetry(op);
    expect(result).toBe("first-try");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable error and eventually succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" })
      .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" })
      .mockResolvedValueOnce("third-try");

    const promise = withRetry(op);
    // Advance past all backoff windows (500ms + 1000ms ≈ 1500ms + jitter).
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe("third-try");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-retryable error", async () => {
    const op = vi
      .fn()
      .mockRejectedValue({ status: 400, message: "Bad Request" });
    await expect(withRetry(op)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("invokes onRetry exactly once per retryable failure (not on the final attempt)", async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("done");

    const promise = withRetry(op, { onRetry });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    // Two failures → two onRetry invocations. The successful attempt doesn't fire it.
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Object));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Object));
  });

  it("converts an exhausted-retry 429 into a RateLimitedError", async () => {
    const op = vi
      .fn()
      .mockRejectedValue({ status: 429, message: "rate limited" });
    // Catch once and assert on the captured value so vitest only ever sees a single rejection.
    const captured = withRetry(op, { maxAttempts: 2 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await captured;
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
  });

  it("converts an exhausted-retry 5xx into a ServiceUnavailableError", async () => {
    const op = vi
      .fn()
      .mockRejectedValue({ status: 502, message: "Bad Gateway" });
    const captured = withRetry(op, { maxAttempts: 2 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await captured;
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err).toMatchObject({ statusCode: 503, code: "SERVICE_UNAVAILABLE" });
  });

  it("respects an explicit maxAttempts override", async () => {
    const op = vi.fn().mockRejectedValue({ status: 503 });
    const captured = withRetry(op, { maxAttempts: 5 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await captured;
    expect(err).toBeDefined();
    expect(op).toHaveBeenCalledTimes(5);
  });

  it("never retries when the caller's signal aborts first", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const op = vi.fn().mockResolvedValue("never");
    await expect(withRetry(op, { signal: ctl.signal })).rejects.toBeInstanceOf(
      AppError,
    );
    expect(op).not.toHaveBeenCalled();
  });

  it("re-throws an AppError unchanged when retries are exhausted", async () => {
    // AppError is the contract surface, so wrapping it again would create a
    // double-wrapped error and lose the original code.
    const op = vi
      .fn()
      .mockRejectedValue(new RateLimitedError("custom message"));
    const captured = withRetry(op, { maxAttempts: 2 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await captured;
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ message: "custom message" });
  });

  it("retries an UpstreamTimeoutError (sentinel from withTimeout)", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamTimeoutError("timeout 1"))
      .mockResolvedValueOnce("recovered");
    const promise = withRetry(op);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toBe("recovered");
  });
});

// =============================================================================
// parseAIJson
// =============================================================================

describe("parseAIJson", () => {
  it("parses a plain JSON object", () => {
    expect(parseAIJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
  });

  it("parses a plain JSON array", () => {
    expect(parseAIJson<number[]>("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("strips ```json fences", () => {
    const raw = '```json\n{"name":"Alex"}\n```';
    expect(parseAIJson(raw)).toEqual({ name: "Alex" });
  });

  it("strips plain ``` fences without language", () => {
    const raw = '```\n{"name":"Alex"}\n```';
    expect(parseAIJson(raw)).toEqual({ name: "Alex" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseAIJson('   \n\n{"a":1}\n  ')).toEqual({ a: 1 });
  });

  it("recovers when the model wraps JSON in prose", () => {
    const raw =
      'Here is the JSON you asked for: {"verdict":"merge","confidence":0.92} — let me know.';
    expect(parseAIJson(raw)).toEqual({ verdict: "merge", confidence: 0.92 });
  });

  it("recovers a JSON array embedded in prose", () => {
    const raw = 'Top candidates are ["alice","bob"] in that order.';
    expect(parseAIJson(raw)).toEqual(["alice", "bob"]);
  });

  it("handles nested braces in string values without false termination", () => {
    const raw = '{"caption":"He said {hi}","ok":true}';
    expect(parseAIJson(raw)).toEqual({ caption: "He said {hi}", ok: true });
  });

  it("throws AI_INVALID_JSON on empty input", () => {
    expect(() => parseAIJson("")).toThrow(AppError);
    expect(() => parseAIJson("   ")).toThrow(AppError);
    try {
      parseAIJson("");
    } catch (err) {
      expect((err as AppError).code).toBe("AI_INVALID_JSON");
      expect((err as AppError).statusCode).toBe(502);
    }
  });

  it("throws AI_INVALID_JSON when no recoverable JSON is present", () => {
    expect(() => parseAIJson("definitely not json")).toThrow(AppError);
    try {
      parseAIJson("definitely not json", "ctx");
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe("AI_INVALID_JSON");
      expect(e.details).toMatchObject({ context: "ctx" });
    }
  });

  it("does not crash on non-string input", () => {
    expect(() => parseAIJson(null as unknown as string)).toThrow(AppError);
    expect(() => parseAIJson(123 as unknown as string)).toThrow(AppError);
  });
});

// =============================================================================
// Defaults sanity check
// =============================================================================

describe("AI_DEFAULTS", () => {
  it("exposes the published timeout, retry, and backoff numbers", () => {
    expect(AI_DEFAULTS.perAttemptTimeoutMs).toBe(60_000);
    expect(AI_DEFAULTS.maxAttempts).toBe(3);
    expect(AI_DEFAULTS.baseBackoffMs).toBe(500);
    expect(AI_DEFAULTS.jitterMs).toBe(250);
  });
});
