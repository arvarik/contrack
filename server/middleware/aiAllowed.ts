/**
 * requireAiAllowed — refuse AI requests when AI is off for the instance or for
 * the caller.
 *
 * Checks `isAiCostPath(req.path)`. When true:
 *   1. An admin turned AI off for the instance (`isAiOffForInstance`): answers
 *      403 `AI_OFF_FOR_INSTANCE`, for every account.
 *   2. The caller switched AI off (`aiAssist` preference): answers 403
 *      `AI_OFF_FOR_ACCOUNT`.
 *
 * Ask Contrack (`POST /api/search/semantic`) is the exception: its keyword
 * and vector search are local, so it answers with AI off. The route reads
 * both switches with `aiAllowedFor` and the service skips every model stage.
 * The AI rate limiters still count the path.
 *
 * An Exact scan for duplicates (`POST /api/dedupe/scan` with `mode:
 * "quick"`) is the second exception. It compares emails, phones and names
 * and calls no model, so it runs with AI off. An AI scan or a Full AI scan
 * embeds contacts and asks a model, so it stays behind both switches.
 *
 * Mounted after `attachPrincipal` in `server/app.ts`.
 *
 * @module middleware/aiAllowed
 */
import type { Request, Response, NextFunction } from "express";
import { isAiCostPath } from "./rateLimit.ts";
import { aiAllowedForUser, isAiOffForInstance } from "../ai/instanceSwitch.ts";
import { AppError } from "../utils/AppError.ts";

/** AI paths that still answer, from local data, when AI is off. */
const LOCAL_FIRST_PATTERNS: RegExp[] = [/^\/api\/search\/semantic\/?$/];

const DEDUPE_SCAN_PATH = /^\/api\/dedupe\/scan\/?$/;

/**
 * True for a scan that runs no model. The mode is in the body, and the JSON
 * parser in `server/app.ts` reads the body before this middleware runs. The
 * route defaults a missing mode to `deep`, so only an explicit `quick` passes.
 */
function isQuickScan(req: Request, path: string): boolean {
  if (req.method !== "POST" || !DEDUPE_SCAN_PATH.test(path)) return false;
  const body = req.body as { mode?: unknown } | undefined;
  return body?.mode === "quick";
}

/**
 * False when AI is off for the instance, or the signed-in caller has
 * switched it off. A request with no account (sign-in not required) follows
 * the instance switch alone.
 */
export function aiAllowedFor(req: Request): boolean {
  const userId = req.principal?.user.id;
  return userId ? aiAllowedForUser(userId) : !isAiOffForInstance();
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
    LOCAL_FIRST_PATTERNS.some((pattern) => pattern.test(path)) ||
    isQuickScan(req, path)
  ) {
    return next();
  }

  // The instance first: the account switch cannot turn AI back on, so its
  // message would send the person to a setting that changes nothing.
  if (isAiOffForInstance()) {
    return next(
      new AppError("An admin turned AI off for this instance", 403, {
        code: "AI_OFF_FOR_INSTANCE",
      }),
    );
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
