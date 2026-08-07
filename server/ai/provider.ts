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
import type { ModelClass } from "./routing/registry.ts";

/**
 * Which capabilities a discovered model can serve.
 *
 * "grounding" is deliberately separate from "chat": every provider that can
 * ground answers in live web search only supports it on a *subset* of its
 * chat models, and offering the rest as web-research options produces a
 * setting that saves fine and then fails at call time. No provider reports
 * this in its list-models response, so each adapter derives it from the
 * documented model families — see `listModels` in each adapter.
 */
export type ModelCapability = "chat" | "embeddings" | "grounding";

/** A model as reported by a provider's list-models API. */
export interface ModelInfo {
  /** Provider-native model id, passed back verbatim in requests. */
  id: string;
  /** Human-readable name for the settings UI. */
  label: string;
  /** What this model can be used for. */
  capabilities: ModelCapability[];
  /**
   * How chat/embeddings capability was determined:
   * - "declared": the provider's API states it (Gemini, Anthropic)
   * - "guessed":  inferred from the id (OpenAI, compat servers) — the UI
   *               lets the user override.
   *
   * Note this does NOT describe "grounding", which is always inferred from
   * the model family regardless of provider.
   */
  capabilityConfidence: "declared" | "guessed";
  /** Optional context-window size, when the provider reports it. */
  contextWindow?: number;
}

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

  /**
   * Optional: whether this provider can ground responses in live web search.
   * Defaults to true for the three native adapters; the generic
   * OpenAI-compatible adapter sets it false.
   */
  readonly supportsSearchGrounding?: boolean;

  /**
   * Optional: enumerate models available to these credentials.
   * Used by the settings UI for discovery + key validation. Providers
   * without a list API omit it.
   */
  listModels?(): Promise<ModelInfo[]>;

  /**
   * Optional: the model id this provider would actually use for a routing
   * class, with no pin in effect.
   *
   * Settings previously described unpinned capabilities as "chosen
   * automatically", which is true and useless — it tells the user nothing
   * about what will run or what it costs. Adapters that can name their pick
   * ahead of the call implement this so the UI can show the model instead of
   * the word "automatically".
   *
   * Returns undefined when the choice genuinely cannot be known in advance
   * (a compat endpoint whose model set is arbitrary).
   */
  defaultModelFor?(modelClass: ModelClass): string | undefined;

  /**
   * Optional: generate embedding vectors. Only implemented by providers whose
   * models are selectable for the embeddings capability.
   */
  embed?(texts: string[], model: string): Promise<number[][]>;
}
