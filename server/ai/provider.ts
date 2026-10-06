// The contract every LLM provider adapter implements. Business code programs
// against it, never against an SDK.

import type {
  AIGenerateOptions,
  AIGenerateResult,
  DiagnosticsSnapshot,
} from "./types.ts";
import type { ModelClass } from "./routing/registry.ts";
import type { EmbedUse } from "./embedder.ts";

/**
 * Which capabilities a discovered model can serve. "grounding" is apart from
 * "chat" because every provider grounds in live web search on only some of its
 * chat models, and offering the rest for research makes a setting that saves
 * and then fails. No provider reports it, so each adapter derives it from the
 * model families (`listModels`).
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
   * How chat and embeddings capability was found:
   * - "declared": the provider's API states it (Gemini, Anthropic)
   * - "guessed":  inferred from the id (OpenAI, compatible servers); the UI
   *   lets the user override it
   *
   * "grounding" is always inferred from the model family.
   */
  capabilityConfidence: "declared" | "guessed";
  /** Optional context-window size, when the provider reports it. */
  contextWindow?: number;
  /**
   * When the provider released the model, in ms since the epoch, when it
   * says. The catalog drops chat models older than a year.
   */
  releasedAt?: number;
  /**
   * Effort levels the model accepts ("low", "medium"...), when the provider
   * declares them. Anthropic does; a model that lists none takes no effort.
   */
  efforts?: string[];
}

/**
 * An LLM provider. Each adapter (Gemini, OpenAI, Anthropic, OpenAI-compatible)
 * translates `AIGenerateOptions` into its SDK call and normalizes the answer
 * into `AIGenerateResult`.
 */
export interface AIProvider {
  /** Human-readable provider name for logging (e.g., "Gemini", "OpenAI"). */
  readonly name: string;

  /**
   * Send a prompt and return the answer. An adapter translates
   * `options.jsonSchema` to its native format, handles model fallbacks and
   * retries, and reports latency and token counts.
   *
   * @throws Error if all models / retries are exhausted
   */
  generate(options: AIGenerateOptions): Promise<AIGenerateResult>;

  /**
   * Optional: the same generation, streamed. `onDelta` gets each new piece of
   * text in order, then the call resolves with what `generate` returns, `text`
   * being the pieces joined. The Ask brief uses it so the text grows word by
   * word.
   *
   * The rules of `generate` hold for `signal`, `timeoutMs` and routing. A JSON
   * or grounded request is not streamed: the adapter runs `generate` and sends
   * one piece. A retry is allowed only before the first piece, because a sent
   * piece cannot be taken back. For an adapter without a stream, `streamFor` in
   * the gateway calls `generate` and sends one piece.
   */
  generateStream?(
    options: AIGenerateOptions,
    onDelta: (text: string) => void,
  ): Promise<AIGenerateResult>;

  /**
   * Optional: routing diagnostics and quota state, for providers that track
   * quota (Gemini). The `getQuotaSnapshot()` helper on the barrel export
   * returns an empty snapshot for the rest.
   */
  getQuotaSnapshot?(): DiagnosticsSnapshot;

  /**
   * Optional: whether this provider can ground answers in live web search. True
   * by default for the three native adapters; the OpenAI-compatible adapter
   * sets it false.
   */
  readonly supportsSearchGrounding?: boolean;

  /**
   * Optional: the models these credentials can use, for discovery and key
   * validation in Settings. Omitted by providers without a list API.
   */
  listModels?(): Promise<ModelInfo[]>;

  /**
   * Optional: the model this provider would use for a routing class with no
   * pin, so Settings can name the model instead of "automatically". Undefined
   * when the choice cannot be known in advance (a compatible endpoint with an
   * arbitrary model set). `grounding` asks for a model that can search the web,
   * which research needs.
   */
  defaultModelFor?(
    modelClass: ModelClass,
    options?: { grounding?: boolean },
  ): string | undefined;

  /**
   * Optional: embedding vectors, from providers whose models can serve the
   * embeddings capability. `use` says what the texts are for: an adapter whose
   * models embed by task reads it (Gemini's task types), others ignore it, and
   * a call without one gets the model's default.
   */
  embed?(texts: string[], model: string, use?: EmbedUse): Promise<number[][]>;
}
