// =============================================================================
// Request context — AsyncLocalStorage for attribution
// =============================================================================
// The context carries who is asking so an insert can stamp ownerId without
// threading a parameter through every signature. It is NOT the isolation
// mechanism. Reads and writes of owned data take an explicit Scope, because
// a context can be lost across a library boundary and a lost context must
// never widen what a query returns.
//
// One rule matters most. An EventEmitter listener runs in the async context
// of whoever calls emit(), not the context that subscribed. Every SSE and
// NDJSON handler therefore captures its Scope in the closure before it
// subscribes, and never calls currentScope() inside a listener.
// =============================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.ts";
import type { Principal } from "../middleware/auth.ts";
import { scopeForUser, type Scope } from "./scope.ts";
import { primaryAdminId } from "../db.ts";

export interface RequestContext {
  requestId: string;
  principal: Principal | null;
  scope: Scope | null;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): RequestContext | null {
  return als.getStore() ?? null;
}

/** The current scope, or a programmer error if there is none. */
export function currentScope(): Scope {
  const s = getContext()?.scope;
  if (!s)
    throw new AppError("No owner scope on this code path", 500, {
      code: "NO_SCOPE",
    });
  return s;
}

/** The current scope, or null. Used by inserts that may run unowned. */
export function currentScopeOrNull(): Scope | null {
  return getContext()?.scope ?? null;
}

export function attachRequestContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const p = req.principal ?? null;
  const scope = p?.kind === "user" ? scopeForUser(p.user) : null;
  runWithContext({ requestId: req.requestId, principal: p, scope }, () =>
    next(),
  );
}

/**
 * The owner to stamp on a row being written now.
 *
 * Inside a request this is the caller. Outside one — a scheduled dedupe scan,
 * an embedding backfill, a seed script — it is the primary admin, which on an
 * auth-off instance is the local owner.
 *
 * Phase 0 wrote NULL here because no account was guaranteed to exist. Phase 1
 * creates one on every instance and forbids NULL with a trigger, so the
 * fallback is now both possible and necessary. Phase 2 wraps every background
 * job in runWithContext, after which a multi-user instance stops reaching it.
 */
export function currentOwnerId(): string {
  return currentScopeOrNull()?.ownerId ?? primaryAdminId();
}
