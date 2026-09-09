import { sqlite } from "../db.ts";
import { NotFoundError } from "../utils/AppError.ts";
import { scopeOf, type Scope } from "../tenancy/scope.ts";
import type { Request, Response, NextFunction } from "express";

/**
 * Require a saved contact the scope owns, which is neither trashed nor merged.
 * Archived contacts remain editable.
 *
 * The owner and the id are in one statement, so a foreign id is a miss rather
 * than a row that is read and then rejected. The 404 carries no id and no
 * reason: "not yours" and "does not exist" must look the same from outside.
 *
 * Sub-phase 2a added this beside an unscoped `assertContactExists`, which the
 * interaction, action item, and list services still called. 2b converted those
 * three, so the unscoped form has no callers left and is gone.
 */
export function assertOwnedContact(scope: Scope, id: string): void {
  if (
    !sqlite
      .prepare(
        `SELECT 1 FROM contacts
          WHERE id = ? AND ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL`,
      )
      .get(id, scope.ownerId)
  ) {
    throw new NotFoundError("Contact");
  }
}

/** Reject an invalid parent before accepting uploads or starting AI work. */
export function requireContact(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  assertOwnedContact(scopeOf(req), String(req.params.id));
  next();
}
