// A fixed-window rate limiter with no dependency, for endpoints that make
// billable LLM calls or outbound fetches. State is in memory, which fits the
// single-process deployment.
//
// The AI-cost routes have two limiters. The per-IP one ("is one machine
// hammering this instance") runs before anybody is identified, so it also
// covers callers with no account. The per-user one ("is one account spending
// more than its share of a shared key") runs once `attachPrincipal` has said
// who is asking. Behind one office address, per-IP alone would let one person
// spend everybody's budget, and per-user alone would let an unidentified caller
// retry forever.

import type { Request, Response, NextFunction } from "express";
import { RateLimitedError } from "../utils/AppError.ts";
import { trimTrailingSlashes } from "../utils/urlPath.ts";

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * A limiter middleware with its counters exposed for tests. `reset` exists
 * because a fixed window is shared by every request in a process: a test file
 * that signs in a dozen times would trip a limiter meant for real clients, and
 * a test-only env var that loosens the limit would test something that does not
 * ship.
 */
export interface RateLimiter {
  (req: Request, res: Response, next: NextFunction): void;
  /** Forget all windows. */
  reset(): void;
}

/**
 * Create a fixed-window rate limiter. `keyBy` names the window a request
 * belongs to, the client IP by default. A `null` key skips the limiter, so a
 * per-user limiter ignores an unidentified caller instead of lumping them all
 * into one window. Windows are pruned on access, so memory is bounded by the
 * keys seen within one window.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  name: string;
  keyBy?: (req: Request) => string | null;
}): RateLimiter {
  const { windowMs, max, name, keyBy } = options;
  const windows = new Map<string, WindowState>();

  const middleware = (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    const now = Date.now();
    const key = keyBy ? keyBy(req) : (req.ip ?? "unknown");
    if (key === null) return next();

    const state = windows.get(key);
    if (!state || state.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      // Lazy prune: drop expired windows so the map can't grow unbounded.
      if (windows.size > 1000) {
        for (const [k, v] of windows) {
          if (v.resetAt <= now) windows.delete(k);
        }
      }
      return next();
    }

    state.count += 1;
    if (state.count > max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.resetAt - now) / 1000),
      );
      // The wait goes in `details`, and the error handler turns it into the
      // `Retry-After` header for every 429 in the app; a second mechanism here
      // could quietly stop being tested.
      return next(
        new RateLimitedError(
          `Too many requests to ${name} — retry in ${retryAfterSeconds}s`,
          { retryAfterSeconds },
        ),
      );
    }
    next();
  };

  middleware.reset = () => windows.clear();
  return middleware;
}

/**
 * Paths that make billable AI calls or outbound fetches. `POST
 * /api/contacts/bulk` is left out on purpose: an import is rare, capped at 50
 * MB, and does its AI work after the response.
 */
const AI_COST_PATTERNS: RegExp[] = [
  /^\/api\/search\/semantic/,
  /^\/api\/search\/synthesize/,
  /^\/api\/parse-contact/,
  /^\/api\/contacts\/[^/]+\/enrich/,
  /^\/api\/contacts\/[^/]+\/briefing/,
  /^\/api\/ai-search$/,
  /^\/api\/dedupe\/backfill-embeddings/,
  /^\/api\/dedupe\/scan/,
  /^\/api\/dashboard\/insight/,
  /^\/api\/link-preview/,
];

/**
 * True for a path the two limiters below cover. Express routes ignore case and
 * a trailing slash, so `GET /API/Dashboard/Insight` and `POST /api/ai-search/`
 * reach the same billable handlers as their plain spellings. The path is
 * lowercased and trimmed first, or one capital letter or a trailing slash would
 * slip past both limiters.
 */
export function isAiCostPath(path: string): boolean {
  const normalized = trimTrailingSlashes(path.toLowerCase());
  return AI_COST_PATTERNS.some((p) => p.test(normalized));
}

const aiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  name: "AI endpoints",
});

/**
 * Per account, at half the per-IP allowance, so one person cannot spend the
 * instance's provider budget while colleagues on the same office address are
 * refused for it. An unidentified request gets a `null` key and is left to the
 * per-IP limiter, which has already seen it.
 */
const aiUserLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  name: "AI endpoints for this account",
  keyBy: (req) => req.principal?.user.id ?? null,
});

/**
 * The per-IP AI limiter, for the paths that cost. Mounted before
 * `attachPrincipal`, so it covers callers with no account.
 */
export function aiEndpointRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isAiCostPath(req.path)) return aiLimiter(req, res, next);
  next();
}

/**
 * The same paths, per account. Mounted after `attachPrincipal` and
 * `attachRequestContext`, because it needs to know who is asking.
 */
export function aiUserRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isAiCostPath(req.path)) return aiUserLimiter(req, res, next);
  next();
}

/** Clear both AI windows. Test seam — see RateLimiter.reset. */
export function __resetAiRateLimits(): void {
  aiLimiter.reset();
  aiUserLimiter.reset();
}
