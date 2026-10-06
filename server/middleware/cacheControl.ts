// Cache-Control: what a browser and a proxy may keep. Express sends no
// `Cache-Control` on a JSON response, and a response without caching headers is
// one a shared cache may store and hand to somebody else by heuristics. Several
// people can share an instance behind any proxy, and the responses covered here
// differ per caller: who is signed in, who else has an account, what the
// instance has spent, a whole account's data in one file.

import type { Request, Response, NextFunction } from "express";

/**
 * The four prefixes that must never be stored:
 * - `/api/auth` answers who you are, and sets and clears session cookies.
 * - `/api/admin` is every account on the instance, the audit log and the
 *   instance's health.
 * - `/api/ai/stats` is what the instance has spent, per account for an admin.
 * - `/api/export` is a whole account's data as one download.
 *
 * Written out rather than derived, because the list is a statement about what
 * the responses contain, and `/api` as a whole is not that statement.
 */
export const NO_STORE_PREFIXES = [
  "/api/auth",
  "/api/admin",
  "/api/ai/stats",
  "/api/export",
] as const;

/**
 * `no-store`: do not write this anywhere. Not `no-cache`, which allows storing
 * and only forbids reuse without revalidation. The extra directives are for
 * caches older than `no-store` and ones that treat a missing expiry as
 * permission.
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
 * `private` for an uploaded file. `express.static` sends `public, max-age=0`,
 * and `public` lets a shared cache keep the response. An upload under
 * `/uploads/u/<ownerId>/…` belongs to one account, so a proxy holding it could
 * hand it to the next person who asks for that URL. `max-age=0` still means
 * revalidate every time.
 */
export const UPLOAD_CACHE_CONTROL = "private, max-age=0, must-revalidate";
