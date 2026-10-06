// AsyncLocalStorage for attribution: who is asking, so an insert can stamp
// ownerId without a parameter in every signature. It is NOT the isolation
// mechanism: reads and writes of owned data take an explicit Scope, because a
// context can be lost across a library boundary, and a lost context must never
// widen what a query returns. An EventEmitter listener runs in the context of
// whoever calls emit(), not the subscriber's, so every SSE and NDJSON handler
// captures its Scope before it subscribes and never calls currentScopeOrNull()
// inside a listener.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
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
 * The owner to stamp on a row being written now: the caller inside a request,
 * and outside one (a scheduled scan, a backfill, a seed script) the primary
 * admin, which on an auth-off instance is the local owner. Background jobs run
 * inside runWithContext, so a multi-user instance does not normally reach the
 * fallback.
 */
export function currentOwnerId(): string {
  return currentScopeOrNull()?.ownerId ?? primaryAdminId();
}
