// Helpers shared by the AI service modules.

import { log } from "../../utils/logger.ts";
import { isAnyProviderConfigured } from "../gateway.ts";

/** Returns true when the AI provider has no valid API key and will use mock responses. */
export function isMockMode(): boolean {
  return !isAnyProviderConfigured();
}

/**
 * Parse JSON from a model's answer, or null. Models sometimes return an empty
 * string or malformed JSON despite the schema, and a SyntaxError must not crash
 * the caller.
 */
export function safeParseJson<T>(text: string, context: string): T | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // The parse message quotes the output, so the line gives its length.
    log.error(
      "AIService",
      `[${context}] The model output (${text.length} characters) is not JSON`,
    );
    return null;
  }
}
