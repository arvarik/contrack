/**
 * The sentence to show when the server answers `429`.
 *
 * One instance now has several accounts sharing one provider key, one dedupe
 * worker, and one enrichment lock, so a refusal is no longer always about the
 * reader. Three cases, and they need different words:
 *
 *   1. Somebody else holds the lock, and the server will start this work on
 *      its own when they are done. Nothing to do but wait.
 *   2. Somebody else holds the lock and will not hand it over. Try later.
 *   3. The reader hit their own limit. Wait the stated number of seconds.
 *
 * Saying "too many requests" for the first two blames the reader for a queue
 * they did not create, which is both wrong and unhelpful: it invites them to
 * retry, and retrying is exactly what will not work.
 *
 * Pure, so `tests/unit/frontend.apiClient.test.ts` can pin every branch.
 *
 * @module lib/rateLimitMessage
 */

import { ApiError, rateLimitFacts } from "../api/client";

/** What kind of work was refused. Only changes the noun in the sentence. */
export type LimitedWork = "scan" | "enrichment" | "request";

const OTHERS_WORK: Record<LimitedWork, string> = {
  scan: "Another user's scan is running.",
  enrichment: "Another user's enrichment is running.",
  request: "Another user is using this right now.",
};

/**
 * The message for a failed request, or `null` when it was not a `429`.
 *
 * `null` rather than a fallback, so a caller can tell "this is a rate limit
 * and here is what to say" from "this is something else, use the server's own
 * message" without inspecting the error twice.
 */
export function rateLimitMessage(
  error: unknown,
  work: LimitedWork = "request",
): string | null {
  const facts = rateLimitFacts(error);
  if (!facts) return null;

  // Not every 429 is a rate limit in this sense. The AI layer answers
  // `AI_BUSY` with sentences of its own — "Grounding quota exhausted for
  // today" is one — and replacing that with "try again shortly" tells
  // somebody to retry into a wall that stands until tomorrow. Only the
  // limiters send `RATE_LIMITED`; anything else keeps its own words.
  if (error instanceof ApiError && error.code && error.code !== "RATE_LIMITED")
    return null;

  if (!facts.yours) {
    return facts.queued
      ? `${OTHERS_WORK[work]} Yours will start automatically.`
      : `${OTHERS_WORK[work]} Try again in a moment.`;
  }

  const seconds = facts.retryAfterSeconds;
  if (seconds === undefined) return "Too many requests. Try again shortly.";
  return `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}
