/**
 * AI Resilience Primitives
 * ========================
 * Shared building blocks for every AI adapter: timeouts, retries with
 * jittered exponential backoff, abort propagation, retryable-error
 * classification, and tolerant JSON parsing.
 *
 * Why this module exists:
 * - Without a shared module each adapter reinvents (or skips) these
 *   concerns. The OpenAI and Anthropic adapters previously had NO retry,
 *   NO timeout, NO error classification. The Gemini adapter has retry
 *   logic but no timeout. This module unifies all of that.
 * - JSON parsing for `responseFormat: "json"` was happening at every
 *   call-site downstream. A malformed model response (which happens
 *   under load even on flagship models) would surface as a 500 from
 *   the caller's `JSON.parse`, with no clue that the upstream LLM was
 *   at fault. `parseAIJson()` produces a single, typed error class.
 */

import {
  UpstreamTimeoutError,
  RateLimitedError,
  ServiceUnavailableError,
  AppError,
} from "../utils/AppError.ts";

// ---------------------------------------------------------------------------
// Defaults — tuned for a desktop local-first app where latency matters less
// than reliability. Override per-call via `AIGenerateOptions.timeoutMs`.
// ---------------------------------------------------------------------------

export const AI_DEFAULTS = {
  /** Hard cap per single network attempt. Streaming / grounded calls may need to raise this. */
  perAttemptTimeoutMs: 60_000,
  /** Number of attempts including the first one. 1 = no retry, 3 = up to 2 retries. */
  maxAttempts: 2,
  /** Base backoff for exponential schedule: 500, 1000, 2000 ms (+ jitter). */
  baseBackoffMs: 500,
  /** Max jitter added on top of each backoff step (uniform [0, jitterMs)). */
  jitterMs: 250,
};

// ---------------------------------------------------------------------------
// Retryable-error classifier — shared between providers
// ---------------------------------------------------------------------------

/**
 * Coarse classifier for transient upstream failures.
 *
 * Recognizes:
 *  - HTTP 408 / 429 / 5xx
 *  - SDK error message keywords: "timeout", "ECONNRESET", "ECONNREFUSED",
 *    "rate limit", "quota", "overloaded", "temporarily unavailable"
 *  - Native AbortError when triggered by our own timeout (NOT when the
 *    caller's signal aborts — caller-aborts are surfaced unchanged).
 */
export function isRetryableError(
  error: unknown,
  abortedByTimeout: boolean,
): boolean {
  if (
    error instanceof AppError &&
    ["AI_INVALID_JSON", "AI_SCHEMA_MISMATCH", "AI_BUSY"].includes(error.code)
  )
    return false;
  if (abortedByTimeout) return true;

  const e = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    message?: string;
  };
  const status = typeof e?.status === "number" ? e.status : e?.statusCode;
  if (
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500 && status <= 599)
  ) {
    return true;
  }

  if (typeof status === "number" && status >= 400 && status < 500) return false;

  const code = typeof e?.code === "string" ? e.code : "";
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }

  const msg = (e?.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("overloaded") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("unavailable") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("deadline")
  );
}

// ---------------------------------------------------------------------------
// withTimeout — bound a single network attempt
// ---------------------------------------------------------------------------

/**
 * Run `op(signal)` with a hard timeout. Two outcomes:
 *
 *  - Promise resolves with the op's value within `timeoutMs`.
 *  - Promise rejects with an `UpstreamTimeoutError` once `timeoutMs` elapses.
 *
 * The signal passed into `op` is aborted when the timer fires AND when the
 * outer `parentSignal` aborts (if provided). Adapters MUST forward this
 * signal to their SDK call (`{ signal }` on OpenAI / Anthropic) so the
 * underlying socket is actually closed — without that, the timer just
 * lets the request leak in the background.
 */
export async function withTimeout<T>(
  op: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  parentSignal?.throwIfAborted();
  const controller = new AbortController();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = (reason: unknown) => {
    rejectAbort(reason);
    controller.abort(reason);
  };
  const timer = setTimeout(
    () =>
      abort(
        new UpstreamTimeoutError(`AI call exceeded ${timeoutMs}ms timeout`),
      ),
    timeoutMs,
  );
  const onParentAbort = () =>
    abort(parentSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return op(controller.signal);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

// ---------------------------------------------------------------------------
// withRetry — exponential-backoff retry with jitter and abort propagation
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  jitterMs?: number;
  /** Optional caller-cancellation signal — if it aborts we bail out without further retries. */
  signal?: AbortSignal;
  /**
   * Hook for adapter-specific side-effects between attempts (e.g. tripping a
   * circuit breaker). Called only on retryable errors, BEFORE the backoff.
   */
  onRetry?(attempt: number, err: unknown): void;
}

export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? AI_DEFAULTS.maxAttempts;
  const baseBackoffMs = opts.baseBackoffMs ?? AI_DEFAULTS.baseBackoffMs;
  const jitterMs = opts.jitterMs ?? AI_DEFAULTS.jitterMs;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new AppError("AI call cancelled by caller", 499, {
        code: "CANCELLED",
      });
    }

    try {
      return await op(attempt);
    } catch (err) {
      lastErr = err;

      // Caller cancelled mid-flight — never retry.
      if (opts.signal?.aborted) {
        throw new AppError("AI call cancelled by caller", 499, {
          code: "CANCELLED",
        });
      }

      // UpstreamTimeoutError is always retryable (it's a thrown sentinel from withTimeout).
      const timedOut = err instanceof UpstreamTimeoutError;
      const retryable = timedOut || isRetryableError(err, false);

      if (!retryable || attempt >= maxAttempts) break;

      opts.onRetry?.(attempt, err);
      const backoff =
        baseBackoffMs * Math.pow(2, attempt - 1) + Math.random() * jitterMs;
      await sleep(backoff, opts.signal);
    }
  }

  // Exhausted attempts — convert to a typed AppError so the central handler
  // produces a stable client-facing code instead of a generic 500.
  if (lastErr instanceof AppError) throw lastErr;

  const e = lastErr as {
    status?: number;
    statusCode?: number;
    message?: string;
  };
  const status = typeof e?.status === "number" ? e.status : e?.statusCode;
  if (status === 401 || status === 403)
    throw new AppError(
      "AI provider rejected its credentials. Check AI settings.",
      503,
      { code: "AI_AUTH_FAILED" },
    );
  if (status === 400 || status === 422)
    throw new AppError(
      "AI provider rejected the request. Check the model settings.",
      502,
      { code: "AI_REQUEST_REJECTED" },
    );
  if (status === 429)
    throw new RateLimitedError("AI provider rate limit exceeded", {
      cause: e?.message,
    });
  if (typeof status === "number" && status >= 500) {
    throw new ServiceUnavailableError("AI provider temporarily unavailable", {
      cause: e?.message,
    });
  }
  throw new ServiceUnavailableError("AI provider call failed after retries", {
    cause: e?.message,
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// parseAIJson — tolerant JSON parser for model output
// ---------------------------------------------------------------------------

/**
 * Models occasionally wrap their JSON in markdown code fences, prose, or
 * leading whitespace despite a strict schema. This parser:
 *
 *   1. Strips ```json / ``` fences.
 *   2. Trims surrounding whitespace.
 *   3. Falls back to extracting the first balanced `{...}` or `[...]` block.
 *
 * On any failure, throws an `AppError` with code `"AI_INVALID_JSON"` so the
 * caller can decide whether to retry, surface to the user, or substitute a
 * default. Returns the parsed value with the caller-supplied generic type.
 */
export function parseAIJson<T = unknown>(raw: string, context?: string): T {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new AppError("AI provider returned empty response", 502, {
      code: "AI_INVALID_JSON",
      details: { context, raw },
    });
  }

  let text = raw.trim();

  // Strip markdown fences if present.
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }

  try {
    return JSON.parse(text) as T;
  } catch (firstErr) {
    // Try to recover by extracting the first balanced JSON object/array.
    const recovered = extractFirstJsonValue(text);
    if (recovered !== null) {
      try {
        return JSON.parse(recovered) as T;
      } catch {
        /* fall through to throw below */
      }
    }
    throw new AppError("AI provider returned malformed JSON", 502, {
      code: "AI_INVALID_JSON",
      details: { context, snippet: text.slice(0, 200) },
      cause: (firstErr as Error)?.message,
    });
  }
}

/** Returns the first balanced top-level `{...}` or `[...]` substring, or null. */
function extractFirstJsonValue(s: string): string | null {
  const openers = ["{", "["];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!openers.includes(ch)) continue;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === ch) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return s.slice(i, j + 1);
      }
    }
  }
  return null;
}
