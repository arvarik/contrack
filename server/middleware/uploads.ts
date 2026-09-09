// =============================================================================
// Uploads guard — one owner's files are not another owner's to fetch
// =============================================================================
// Uploads are served by express.static from a single directory tree, so the
// URL is the only thing standing between a file and anyone who can guess it.
// Since Phase 1 the tree is laid out by owner:
//
//   uploads/logos/<domain>.png         shared, a company logo is not personal
//   uploads/u/<ownerId>/avatars/...    one owner's contact avatars
//   uploads/u/<ownerId>/files/...      one owner's interaction attachments
//
// which turns the check into a string comparison. The owner is already in the
// path, and the caller is already on the request, so this middleware reads no
// database and adds no measurable latency to a static file.
//
// Mounted between requireAuth and express.static in server/app.ts, so it only
// ever sees callers that hold a credential. A token principal passes the same
// way a session does, because a token belongs to exactly one account.
// =============================================================================

import type { Request, Response, NextFunction } from "express";
import { NotFoundError } from "../utils/AppError.ts";

/** `/u/<uuid>/` at the start of the path, capturing the owner. */
const OWNER_PREFIX = /^\/u\/([0-9a-f-]{36})\//;

/** A `..` segment in either slash direction, after decoding. */
const TRAVERSAL = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/**
 * Refuse any `/uploads` request that is not the caller's own file.
 *
 * The answer for someone else's file is 404, not 403. A 403 would confirm the
 * file exists, which is the one thing the owner of that file did not agree to
 * share.
 */
export function guardUploads(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  let path: string;
  try {
    // express.static decodes before it resolves, so the guard has to compare
    // the same string the file system will see. `%2e%2e%2f` is `../`.
    path = decodeURIComponent(req.path);
  } catch {
    return next(new NotFoundError("File"));
  }

  if (TRAVERSAL.test(path)) return next(new NotFoundError("File"));

  // Shared: a logo is keyed by company domain and has no owner.
  if (path.startsWith("/logos/")) return next();

  const owner = OWNER_PREFIX.exec(path);
  if (owner && owner[1] === req.principal?.user.id) return next();

  // Everything else, including the flat pre-Phase-1 layout, is gone.
  next(new NotFoundError("File"));
}
