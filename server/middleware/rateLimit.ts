// =============================================================================
// Rate limiting — lightweight fixed-window limiter (no external dependency)
// =============================================================================
// Protects endpoints that trigger billable LLM calls or outbound fetches from
// runaway loops and abuse. State is in-memory, which matches the single-process
// deployment model of this app.
// =============================================================================

import type { Request, Response, NextFunction } from "express";
import { RateLimitedError } from "../utils/AppError.ts";

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Create a fixed-window rate limiter keyed by client IP.
 * Windows are pruned lazily on access, so memory stays bounded by the number
 * of distinct client IPs seen within one window.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  name: string;
}) {
  const { windowMs, max, name } = options;
  const windows = new Map<string, WindowState>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? "unknown";

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
      const retryAfterSec = Math.ceil((state.resetAt - now) / 1000);
      return next(
        new RateLimitedError(
          `Too many requests to ${name} — retry in ${retryAfterSec}s`,
        ),
      );
    }
    next();
  };
}

/** Paths that trigger billable AI calls or outbound network fetches. */
const AI_COST_PATTERNS: RegExp[] = [
  /^\/api\/search\/semantic/,
  /^\/api\/search\/synthesize/,
  /^\/api\/parse-contact/,
  /^\/api\/contacts\/[^/]+\/enrich/,
  /^\/api\/contacts\/[^/]+\/briefing/,
  /^\/api\/ai-search$/,
  /^\/api\/dedupe\/backfill-embeddings/,
  /^\/api\/link-preview/,
];

const aiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  name: "AI endpoints",
});

/**
 * Router-level middleware: applies the AI limiter only to requests whose path
 * matches a known AI/outbound-cost endpoint. Everything else passes through.
 */
export function aiEndpointRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (AI_COST_PATTERNS.some((p) => p.test(req.path))) {
    return aiLimiter(req, res, next);
  }
  next();
}
