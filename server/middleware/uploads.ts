// Uploads guard: one owner's files are not another owner's to fetch.
// express.static serves one directory tree, so the URL is all that stands
// between a file and anybody who can guess it. The tree is laid out by owner:
//
//   uploads/logos/<domain>.png         shared, a company logo is not personal
//   uploads/u/<ownerId>/avatars/...    one owner's contact avatars
//   uploads/u/<ownerId>/files/...      one owner's interaction attachments
//
// so the check is a string comparison: no database read and no measurable
// latency. Mounted between requireAuth and express.static in server/app.ts, so
// it only sees callers with a credential. A token passes like a session,
// because a token belongs to one account.

import type { Request, Response, NextFunction } from "express";
import { NotFoundError } from "../utils/AppError.ts";

/** `/u/<uuid>/` at the start of the path, capturing the owner. */
const OWNER_PREFIX = /^\/u\/([0-9a-f-]{36})\//;

/** `/u/<uuid>/profile/` at the start of the path. */
const PROFILE_PREFIX = /^\/u\/[0-9a-f-]{36}\/profile\//;

/** A `..` segment in either slash direction, after decoding. */
const TRAVERSAL = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/**
 * Refuse any `/uploads` request that is not for the caller's own file, with a
 * 404 rather than a 403: a 403 would confirm the file exists.
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

  // Profile photos are visible to any signed-in user of the instance, so people
  // see each other's avatars (the admin accounts list, for one). Contact
  // avatars and private files stay owner-only.
  if (req.principal && PROFILE_PREFIX.test(path)) return next();

  // Everything else, a path outside `u/<ownerId>/` included, is refused.
  next(new NotFoundError("File"));
}
