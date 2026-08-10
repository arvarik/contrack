// =============================================================================
// AI Services — helpers shared by every domain module
// =============================================================================

import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { isAnyProviderConfigured } from "../gateway.ts";

/** Returns true when the AI provider has no valid API key and will use mock responses. */
export function isMockMode(): boolean {
  return !isAnyProviderConfigured();
}

/**
 * Safely parses a JSON string from an LLM response.
 * LLMs occasionally return empty strings or malformed JSON despite schema enforcement.
 * This prevents an unhandled SyntaxError from crashing the caller.
 */
export function safeParseJson<T>(text: string, context: string): T | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err: unknown) {
    log.error(
      "AIService",
      `[${context}] JSON.parse failed: ${getErrorMessage(err)}. Raw: ${text.slice(0, 200)}`,
    );
    return null;
  }
}
