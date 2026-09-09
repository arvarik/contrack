import { sqlite } from "../db.ts";
import { NotFoundError } from "../utils/AppError.ts";
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

/** Reject an invalid parent before accepting uploads or starting AI work. */
export function requireContact(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  assertContactExists(String(req.params.id));
  next();
}
