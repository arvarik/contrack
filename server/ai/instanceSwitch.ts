// The instance switch: stops every AI provider call on this instance, for every
// account. The account switch (`aiAssist`, Settings → Privacy) stops one
// person's; this one is the admin's. It is on when:
// - AI_DISABLED=true (or 1) is in the environment, which wins: Settings cannot
//   turn AI back on while it is set;
// - the `ai.instanceOff` app setting is set, from the AI providers page.
//
// While it is on, `getProvider` (providerRegistry.ts) resolves no provider, so
// no generation, provider embedding, model discovery or model test leaves the
// server. Embeddings resolve to the built-in local model, so search by meaning
// keeps working.

import {
  getSetting,
  setSetting,
  SETTING_KEYS,
} from "../services/settingsService.ts";
import { getPreferences } from "../services/userPreferencesService.ts";
import { log } from "../utils/logger.ts";

/** What the settings screens show about the switch. */
export interface InstanceAiState {
  /** True when no AI provider call may leave this instance. */
  aiOff: boolean;
  /** True when AI_DISABLED set it, so Settings cannot turn AI back on. */
  lockedByEnv: boolean;
}

/** True when AI_DISABLED is `true` or `1`, in any case. */
export function aiOffLockedByEnv(): boolean {
  const value = process.env.AI_DISABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * True when AI is off for the whole instance. Read on every provider lookup;
 * after the first, the setting is an in-memory cache hit (settingsService).
 */
export function isAiOffForInstance(): boolean {
  return (
    aiOffLockedByEnv() ||
    getSetting<boolean>(SETTING_KEYS.aiInstanceOff) === true
  );
}

/** Turn AI off (true) or back on (false) for every account. */
export function setAiOffForInstance(off: boolean): void {
  setSetting(SETTING_KEYS.aiInstanceOff, off);
  log.info(
    "AIInstance",
    off
      ? "AI turned off for this instance: no provider calls will be made"
      : "AI turned back on for this instance",
  );
}

/** The switch as the settings screens show it. */
export function instanceAiState(): InstanceAiState {
  return { aiOff: isAiOffForInstance(), lockedByEnv: aiOffLockedByEnv() };
}

/**
 * True when Contrack may call an AI provider for this account: the instance
 * switch and the account's `aiAssist` preference both allow it. The request
 * middleware, auto-enrichment and connector email summaries all ask this.
 */
export function aiAllowedForUser(userId: string): boolean {
  if (isAiOffForInstance()) return false;
  return getPreferences(userId).aiAssist !== false;
}
