/**
 * The sentence to show when the server answers `429`. The accounts on an
 * instance share one provider key, one dedupe worker and one enrichment
 * lock, so a refusal is not always about the reader:
 *
 *   1. Somebody else holds the lock, and this work starts on its own after.
 *   2. Somebody else holds the lock. Try later.
 *   3. The reader hit their own limit. Wait the stated seconds.
 *
 * "Too many requests" for the first two would blame the reader for a queue
 * they did not make.
 */

import { ApiError, rateLimitFacts } from "../api/client";

/** What kind of work was refused. Only changes the noun in the sentence. */
type LimitedWork = "enrichment" | "request";

const OTHERS_WORK: Record<LimitedWork, string> = {
  enrichment: "Another user's enrichment is running",
  request: "Another user is using this right now",
};

/**
 * The message for a failed request, or null when it is not a rate limit, so
 * the caller shows the server's own message.
 */
export function rateLimitMessage(
  error: unknown,
  work: LimitedWork = "request",
): string | null {
  const facts = rateLimitFacts(error);
  if (!facts) return null;

  // Only the limiters send `RATE_LIMITED`. Another 429, such as the AI
  // layer's `AI_BUSY` ("Grounding quota exhausted for today"), keeps its own
  // words, since "try again shortly" would be wrong until tomorrow.
  if (error instanceof ApiError && error.code && error.code !== "RATE_LIMITED")
    return null;

  if (!facts.yours) {
    return facts.queued
      ? `${OTHERS_WORK[work]}. Yours will start automatically`
      : `${OTHERS_WORK[work]}. Try again in a moment`;
  }

  const seconds = facts.retryAfterSeconds;
  if (seconds === undefined) return "Too many requests. Try again shortly";
  return `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}`;
}
