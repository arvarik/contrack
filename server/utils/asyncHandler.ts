import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async route handler so any rejected promise (or sync throw) is
 * forwarded to Express's error middleware via `next(err)`.
 *
 * Tighter than the previous version:
 * - Handler must return `Promise<unknown>` (or `unknown`). No accidental `void`.
 * - Returned function is typed as Express `RequestHandler`.
 * - Sync throws are caught too (they would otherwise crash the process when
 *   the handler is invoked outside the awaited promise chain).
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler => {
  return (req, res, next) => {
    try {
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
};
