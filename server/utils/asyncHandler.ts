import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async route handler so a rejected promise, or a sync throw, goes to
 * Express's error middleware through `next(err)`. The handler must return a
 * promise or a value (no accidental `void`), and the result is typed as an
 * Express `RequestHandler`.
 */
export const asyncHandler = (
  fn: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown> | unknown,
): RequestHandler => {
  return (req, res, next) => {
    try {
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
};
