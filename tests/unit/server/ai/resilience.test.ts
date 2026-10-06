// Unit: the AI resilience primitives every adapter is built on:
//   - withTimeout          → bounds a single attempt, surfaces UpstreamTimeoutError
//   - withRetry            → jittered exponential-backoff with abort propagation
//   - isRetryableError     → coarse classifier for transient upstream failures
//   - parseAIJson          → tolerant JSON parsing for model output
//
// The production code schedules a real backoff (500ms plus jitter before the
// one retry), so these tests use fake timers and never sleep. Every async
// path must work with `vi.advanceTimersByTimeAsync`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  isRetryableError,
  parseAIJson,
  withRetry,
  withTimeout,
} from "../../../../server/ai/resilience.ts";
import {
  AppError,
  RateLimitedError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
} from "../../../../server/utils/AppError.ts";

// isRetryableError

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

// withTimeout

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the op's value when it finishes within the deadline", async () => {
    const op = vi.fn(async () => "ok");
    const promise = withTimeout(op, 1_000);
    await expect(promise).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("throws UpstreamTimeoutError and aborts the op's signal when the op exceeds the deadline", async () => {
    let opSignal!: AbortSignal;
    const op = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        opSignal = signal;
        signal.addEventListener("abort", () => reject(new Error("Aborted")));
      });

    const captured = withTimeout(op, 100).catch((e) => e);
    // Drive the timer past the deadline so the AbortController fires.
    await vi.advanceTimersByTimeAsync(150);
    const err = await captured;
    expect(err).toBeInstanceOf(UpstreamTimeoutError);
    expect(err).toMatchObject({ statusCode: 504, code: "UPSTREAM_TIMEOUT" });
    // The op's own signal aborts too, so the SDK call closes its socket.
    expect(opSignal.aborted).toBe(true);
    expect(opSignal.reason).toBeInstanceOf(UpstreamTimeoutError);
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

  it("never starts a generation after caller cancellation", async () => {
    const parentCtl = new AbortController();
    parentCtl.abort();
    const op = vi.fn().mockResolvedValue("late");
    await expect(withTimeout(op, 1000, parentCtl.signal)).rejects.toBeTruthy();
    expect(op).not.toHaveBeenCalled();
  });
  it("enforces the deadline even when the operation ignores its signal", async () => {
    const result = withTimeout(() => new Promise(() => {}), 100).catch(
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toBeInstanceOf(UpstreamTimeoutError);
  });
});

// withRetry

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
      .mockResolvedValueOnce("second-try");

    const promise = withRetry(op);
    // Advance past the backoff window (500ms + jitter).
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe("second-try");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable error", async () => {
    const op = vi
      .fn()
      .mockRejectedValue({ status: 400, message: "Bad Request" });
    await expect(withRetry(op)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("never retries malformed output or authentication failures", async () => {
    const invalid = vi
      .fn()
      .mockRejectedValue(
        new AppError("invalid JSON", 502, { code: "AI_INVALID_JSON" }),
      );
    const unauthorized = vi.fn().mockRejectedValue({
      status: 401,
      message: "quota unavailable for this key",
    });
    const refusedJson = expect(withRetry(invalid)).rejects.toThrow(
      "invalid JSON",
    );
    const refusedKey = expect(withRetry(unauthorized)).rejects.toThrow();
    // Past every backoff window, so a retry would have run by now.
    await vi.advanceTimersByTimeAsync(5_000);

    await refusedJson;
    await refusedKey;
    expect(invalid).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it("invokes onRetry exactly once per retryable failure (not on the final attempt)", async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 });

    const captured = withRetry(op, { onRetry }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    await captured;

    // Two failures, and the second is the final attempt → one onRetry invocation.
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Object));
  });

  it("converts an exhausted-retry 429 into a RateLimitedError", async () => {
    const op = vi
      .fn()
      .mockRejectedValue({ status: 429, message: "rate limited" });
    // Catch once and assert on the captured value so vitest only ever sees a single rejection.
    const captured = withRetry(op).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await captured;
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
  });

  it("converts an exhausted-retry 5xx into a ServiceUnavailableError", async () => {
    const op = vi
      .fn()
      .mockRejectedValue({ status: 502, message: "Bad Gateway" });
    const captured = withRetry(op).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await captured;
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err).toMatchObject({ statusCode: 503, code: "SERVICE_UNAVAILABLE" });
    // At most one application retry: two calls in all.
    expect(op).toHaveBeenCalledTimes(2);
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
    const captured = withRetry(op).catch((e) => e);
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

// parseAIJson

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

describe("withRetry: an account out of credit", () => {
  it("says so, in the provider's words, without retrying", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(
        new Error(
          '{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}',
        ),
        { status: 402 },
      );
    });
    await expect(withRetry(op)).rejects.toMatchObject({
      code: "AI_BILLING",
      statusCode: 402,
      message: expect.stringContaining("prepayment credits are depleted"),
    });
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry: a model the provider does not serve", () => {
  it("says so, in the provider's words, without retrying", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(
        new Error(
          '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users.","status":"NOT_FOUND"}}',
        ),
        { status: 404 },
      );
    });
    await expect(withRetry(op)).rejects.toMatchObject({
      code: "AI_MODEL_UNAVAILABLE",
      message: expect.stringContaining("no longer available to new users"),
    });
    expect(op).toHaveBeenCalledTimes(1);
  });
});
