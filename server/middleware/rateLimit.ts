// =============================================================================
// Rate limiting — lightweight fixed-window limiter (no external dependency)
// =============================================================================
// Protects endpoints that trigger billable LLM calls or outbound fetches from
// runaway loops and abuse. State is in-memory, which matches the single-process
// deployment model of this app.
//
// Two limiters sit on the AI-cost routes, and they answer different questions.
// The per-IP one asks "is one machine hammering this instance", and it runs
// before anybody is identified, so it also protects the sign-in path from a
// caller with no account. The per-user one asks "is one account spending more
// than its share of a shared provider key", and it can only run once
// `attachPrincipal` has said who is asking. Neither replaces the other: on a
// multi-user instance behind one office address, the per-IP limiter alone
// would let one person exhaust everybody's budget, and the per-user limiter
// alone would let an unidentified caller retry forever.
// =============================================================================

import type { Request, Response, NextFunction } from "express";
import { RateLimitedError } from "../utils/AppError.ts";

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * A limiter middleware with its counters exposed for testing.
 *
 * `reset` exists because a fixed window is shared state across every request
 * in a process: a test file that exercises sign-in a dozen times would trip a
 * limiter meant for real clients, and the alternative — an env var that
 * loosens the limit under test — means the thing being tested is not the thing
 * that ships.
 */
export interface RateLimiter {
  (req: Request, res: Response, next: NextFunction): void;
  /** Forget all windows. */
  reset(): void;
}

/**
 * Create a fixed-window rate limiter.
 *
 * `keyBy` decides what a window belongs to, and defaults to the client IP. A
 * key of `null` skips the limiter for that request, which is what lets a
 * per-user limiter ignore a caller nobody has identified rather than lumping
 * every such caller into one window.
 *
 * Windows are pruned lazily on access, so memory stays bounded by the number
 * of distinct keys seen within one window.
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
      // The wait goes in `details` and the error handler turns it into the
      // `Retry-After` header, which is the one place that does so for every
      // 429 in the app. Setting it here as well would be a second mechanism
      // doing the same job, and the one that could quietly stop being tested.
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
 * Paths that trigger billable AI calls or outbound network fetches.
 *
 * `GET /api/dashboard/insight` and `POST /api/dedupe/scan` were added in
 * Phase 3 (risks document Q16). Both call a provider and neither was listed.
 * `POST /api/contacts/bulk` is deliberately still out: the import is rare, is
 * already capped at 50 MB, and does its AI work after the response.
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

/** True when this path is one the two limiters below cover. */
export function isAiCostPath(path: string): boolean {
  return AI_COST_PATTERNS.some((p) => p.test(path));
}

const aiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  name: "AI endpoints",
});

/**
 * Per account, at half the per-IP allowance.
 *
 * Keyed by the account rather than the address, so one person cannot spend
 * the instance's provider budget while their colleagues on the same office
 * address are refused for it. A request nobody has identified yet returns a
 * `null` key and is left to the per-IP limiter, which has already seen it.
 */
const aiUserLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  name: "AI endpoints for this account",
  keyBy: (req) => req.principal?.user.id ?? null,
});

/**
 * Router-level middleware: applies the per-IP AI limiter only to requests
 * whose path matches a known AI/outbound-cost endpoint. Mounted before
 * `attachPrincipal`, so it runs for callers with no account at all.
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
