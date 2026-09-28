// =============================================================================
// AI Layer — the instance switch
// =============================================================================
// One switch that stops every AI provider call on this instance, for every
// account. The account switch (`aiAssist`, Settings → Privacy) stops the calls
// made for one person. This one belongs to the admin.
//
// Two things turn AI off for the instance:
//   - AI_DISABLED=true (or 1) in the server's environment. It wins: while it
//     is set, Settings cannot turn AI back on.
//   - the `ai.instanceOff` app setting, which an admin sets in Settings → AI.
//
// While it is off, `getProvider` in providerRegistry.ts resolves no provider,
// so no generation, provider embedding, model discovery or model test can
// leave the server. Embeddings resolve to the built-in local model, so search
// by meaning keeps working without a provider.
// =============================================================================

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
 * True when AI is off for the whole instance.
 *
 * Read on every provider lookup. The setting read is an in-memory cache hit
 * after the first one (settingsService), so the check costs nothing.
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
 * True when Contrack may call an AI provider for this account.
 *
 * Both switches must allow it: the instance switch and the account's own
 * `aiAssist` preference. The request middleware, auto-enrichment and
 * connector email summaries all ask this one question.
 */
export function aiAllowedForUser(userId: string): boolean {
  if (isAiOffForInstance()) return false;
  return getPreferences(userId).aiAssist !== false;
}
