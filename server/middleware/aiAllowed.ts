/**
 * requireAiAllowed — refuse AI requests when the caller has switched AI off.
 *
 * Checks `isAiCostPath(req.path)`. When true, checks the caller's `aiAssist`
 * preference. If false, answers 403 `AI_OFF_FOR_ACCOUNT`.
 *
 * Ask Contrack (`POST /api/search/semantic`) is the exception: its keyword
 * and vector search are local, so it answers with AI off. The route reads the
 * switch with `aiAllowedFor` and the service skips every model stage. The AI
 * rate limiters still count the path.
 *
 * Mounted after `attachPrincipal` in `server/app.ts`.
 *
 * @module middleware/aiAllowed
 */
import type { Request, Response, NextFunction } from "express";
import { isAiCostPath } from "./rateLimit.ts";
import { getPreferences } from "../services/userPreferencesService.ts";
import { AppError } from "../utils/AppError.ts";

/** AI paths that still answer, from local data, when AI is off. */
const LOCAL_FIRST_PATTERNS: RegExp[] = [/^\/api\/search\/semantic\/?$/];

/** False when the signed-in caller has switched AI off. */
export function aiAllowedFor(req: Request): boolean {
  const userId = req.principal?.user.id;
  return userId ? getPreferences(userId).aiAssist !== false : true;
}

export function requireAiAllowed(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Lowercased like `isAiCostPath`, because routing ignores case.
  const path = req.path.toLowerCase();
  if (
    !isAiCostPath(req.path) ||
    LOCAL_FIRST_PATTERNS.some((pattern) => pattern.test(path))
  ) {
    return next();
  }

  if (!aiAllowedFor(req)) {
    return next(
      new AppError("AI is off for this account", 403, {
        code: "AI_OFF_FOR_ACCOUNT",
      }),
    );
  }

  next();
}
