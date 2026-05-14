// =============================================================================
// AI Layer — Abstract Provider Interface
// =============================================================================
// The single contract that every LLM provider adapter must implement.
// Business logic in aiService.ts programs against this interface,
// never against SDK-specific classes.
// =============================================================================

import type {
  AIGenerateOptions,
  AIGenerateResult,
  DiagnosticsSnapshot,
} from "./types.ts";

/**
 * Abstract interface for an LLM provider.
 *
 * Each concrete adapter (Gemini, OpenAI, Anthropic, Ollama, etc.) implements
 * this interface, translating the provider-agnostic `AIGenerateOptions` into
 * the SDK-specific API call and normalizing the response into `AIGenerateResult`.
 */
export interface AIProvider {
  /** Human-readable provider name for logging (e.g., "Gemini", "OpenAI"). */
  readonly name: string;

  /**
   * Send a prompt to the LLM and return the response.
   *
   * Implementations should:
   * 1. Translate `options.jsonSchema` into their native schema format
   * 2. Handle model fallbacks / retries internally
   * 3. Measure and report latency in the result
   * 4. Extract token counts from provider-specific response metadata
   *
   * @throws Error if all models / retries are exhausted
   */
  generate(options: AIGenerateOptions): Promise<AIGenerateResult>;

  /**
   * Optional: Return routing diagnostics and quota state.
   *
   * Only meaningful for providers with built-in quota tracking (Gemini).
   * Non-Gemini providers may omit this — callers should use the
   * `getQuotaSnapshot()` helper on the barrel export which returns a
   * safe empty snapshot as fallback.
   */
  getQuotaSnapshot?(): DiagnosticsSnapshot;
}
