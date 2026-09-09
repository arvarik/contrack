import { sqlite } from "../db.ts";
import { NotFoundError } from "../utils/AppError.ts";
import { scopeOf, type Scope } from "../tenancy/scope.ts";
import type { Request, Response, NextFunction } from "express";

/** Require a saved contact which is neither trashed nor merged. Archived contacts remain editable. */
export function assertContactExists(id: string): void {
  if (
    !sqlite
      .prepare(
        "SELECT 1 FROM contacts WHERE id = ? AND deletedAt IS NULL AND canonicalId IS NULL",
      )
      .get(id)
  ) {
    throw new NotFoundError("Contact", id);
  }
}

/**
 * The same check, for the caller's own contacts only.
 *
 * The owner and the id are in one statement, so a foreign id is a miss rather
 * than a row that is read and then rejected. The 404 carries no id and no
 * reason: "not yours" and "does not exist" must look the same from outside.
 *
 * `assertContactExists` above stays for the interaction, action item, and list
 * services until sub-phase 2b threads a scope through them.
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
