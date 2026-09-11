// =============================================================================
// Cache-Control — what a browser and a proxy may keep
// =============================================================================
// Express sends no `Cache-Control` of its own on a JSON response, and a
// response with no caching headers at all is one a shared cache may store and
// hand to somebody else using heuristics. That was tolerable when one person
// ran Contrack on one machine. It is not once several people share an
// instance behind whatever proxy the operator put in front of it, because the
// responses this covers are exactly the ones that differ per caller: who is
// signed in, who else has an account, what the instance has spent, and a
// whole account's data in one file.
//
// `.agent/STATUS.md` carried the stats endpoints as known issue S-03.
// =============================================================================

import type { Request, Response, NextFunction } from "express";

/**
 * The four prefixes that must never be stored.
 *
 * - `/api/auth` answers who you are, and sets and clears session cookies.
 * - `/api/admin` is every account on the instance, the audit log, and the
 *   instance's own health.
 * - `/api/ai/stats` is what the instance has spent, per account for an admin.
 * - `/api/export` is a whole account's data as one download.
 *
 * Written out rather than derived, because a prefix added by accident is
 * worse than one missing on purpose: this list is a statement about what the
 * responses contain, and `/api` as a whole is not that statement.
 */
export const NO_STORE_PREFIXES = [
  "/api/auth",
  "/api/admin",
  "/api/ai/stats",
  "/api/export",
] as const;

/**
 * `no-store`, which means what it says: do not write this anywhere.
 *
 * Not `no-cache`, which permits storing and only forbids reusing without
 * revalidation, and is the one people reach for by mistake. The extra
 * directives are for the caches that predate `no-store` and for the ones that
 * treat a missing expiry as permission.
 */
export function noStore(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

/**
 * `private` for an uploaded file.
 *
 * `express.static` sends `public, max-age=0`, and `public` is an instruction
 * to a shared cache that it may keep the response. An upload lives under
 * `/uploads/u/<ownerId>/…` and belongs to exactly one account, so a proxy
 * holding one is a proxy that can hand somebody else's attachment to the next
 * person who asks for that URL. The freshness is unchanged: `max-age=0` still
 * means revalidate every time.
 */
export const UPLOAD_CACHE_CONTROL = "private, max-age=0, must-revalidate";
