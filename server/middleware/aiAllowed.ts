/**
 * requireAiAllowed — refuse AI requests when the caller has switched AI off.
 *
 * Checks `isAiCostPath(req.path)`. When true, checks the caller's `aiAssist`
 * preference. If false, answers 403 `AI_OFF_FOR_ACCOUNT`.
 *
 * Mounted after `attachPrincipal` in `server/app.ts`.
 *
 * @module middleware/aiAllowed
 */
import type { Request, Response, NextFunction } from "express";
import { isAiCostPath } from "./rateLimit.ts";
import { getPreferences } from "../services/userPreferencesService.ts";
import { AppError } from "../utils/AppError.ts";

export function requireAiAllowed(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!isAiCostPath(req.path)) {
    return next();
  }

  const userId = req.principal?.user.id;
  if (userId) {
    const prefs = getPreferences(userId);
    if (prefs.aiAssist === false) {
      return next(
        new AppError("AI is off for this account", 403, {
          code: "AI_OFF_FOR_ACCOUNT",
        }),
      );
    }
  }

  next();
}
