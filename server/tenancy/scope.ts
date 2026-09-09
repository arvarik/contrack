// =============================================================================
// Scope — the owner a request or a job acts for
// =============================================================================
// Every repository and service function that reads or writes an owned table
// takes a Scope as its first argument, and puts the owner in the same SQL
// statement as the id. The request context in requestContext.ts carries a
// Scope for attribution only. It is never the isolation mechanism.
//
// Phase 0 builds these names so Phase 1 and Phase 2 have one place to change.
// Nothing on the data path calls scopeOf yet.
// =============================================================================

import type { Request } from "express";
import { AppError } from "../utils/AppError.ts";
import type { User } from "../services/authService.ts";

declare const ownerIdBrand: unique symbol;

/** A `users.id`. Branded so a bare string cannot be passed as an owner. */
export type OwnerId = string & { readonly [ownerIdBrand]: true };

export interface Scope {
  readonly ownerId: OwnerId;
}

export function scopeForUser(user: Pick<User, "id">): Scope {
  return Object.freeze({ ownerId: user.id as OwnerId });
}

/** Background jobs only. Never called from a route. */
export function scopeForOwnerId(id: string): Scope {
  return Object.freeze({ ownerId: id as OwnerId });
}

export function scopeOf(req: Request): Scope {
  const p = req.principal;
  if (p?.kind === "user") return scopeForUser(p.user);
  // Phase 0: anonymous and service principals have no owner yet. Phase 1
  // removes both kinds. Until then, callers that need a scope get a 401.
  throw new AppError("Authentication required", 401, { code: "UNAUTHORIZED" });
}

/** FTS5 owner token. Must equal  'o' || replace(ownerId, '-', '')  in server/db.ts. */
export function ownerToken(scope: Scope): string {
  return "o" + scope.ownerId.replace(/-/g, "");
}

/** FTS5 contact token. Must equal  'c' || replace(id, '-', '')  in server/db.ts. */
export function contactToken(contactId: string): string {
  return "c" + contactId.replace(/-/g, "");
}
