// =============================================================================
// Retired environment variables
// =============================================================================
// A variable Contrack stopped reading still sits in people's .env files and
// compose files, where it looks like it does something. Boot names each one
// that is set, once, with what replaced it.
// =============================================================================

import { log } from "./logger.ts";

/** Variable → what to do instead. */
export const RETIRED_ENV: Record<string, string> = {
  AI_TIER:
    "Contrack no longer has a free or paid setting. It learns a Gemini key's limits from Google's 429 answers. Remove AI_TIER.",
};

/**
 * Warn about every retired variable that is set. Returns their names, so a
 * test can check the list without reading logs.
 */
export function warnRetiredEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const found = Object.keys(RETIRED_ENV).filter(
    (name) => env[name] !== undefined && env[name] !== "",
  );
  for (const name of found)
    log.warn("Config", `${name} is ignored. ${RETIRED_ENV[name]}`);
  return found;
}
