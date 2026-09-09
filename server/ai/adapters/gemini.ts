// =============================================================================
// AI Layer — Concrete Gemini Adapter (Smart Mesh v1.2)
// =============================================================================
// This is the ONLY file in the codebase that imports from `@google/genai`.
// All Gemini SDK coupling is contained here. The rest of the AI layer
// programs against the abstract AIProvider interface.
//
// v1.2 upgrade: Replaced static FALLBACK_MODELS chain with the Predictive
// Smart Mesh — tier-aware routing, optimistic quota tracking, circuit
// breakers, and exponential backoff. The public API is unchanged.
// =============================================================================

import { GoogleGenAI, Type } from "@google/genai";
import type { AIProvider } from "../provider.ts";
import type { ModelInfo, ModelCapability } from "../provider.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
  DiagnosticsSnapshot,
} from "../types.ts";
import { QuotaTracker } from "../routing/QuotaTracker.ts";
import { SmartRouter } from "../routing/SmartRouter.ts";
import {
  getAITier,
  getGroundingRPDLimit,
  getModelConfig,
  previewModelForClass,
  type AITier,
  type ModelClass,
} from "../routing/registry.ts";
import { log } from "../../utils/logger.ts";
import {
  withTimeout,
  parseAIJson,
  AI_DEFAULTS,
  withRetry,
  isRetryableError,
} from "../resilience.ts";
import { AppError } from "../../utils/AppError.ts";

// ---------------------------------------------------------------------------
// JSON Schema Translation (unchanged from v1.0)
// ---------------------------------------------------------------------------
// Converts a provider-agnostic JsonSchemaNode tree into Gemini's native
// schema format that uses the `Type.*` enum vocabulary.
// ---------------------------------------------------------------------------

/** Gemini SDK schema node — recursive Record type used by generateContent config. */
type GeminiSchemaNode = {
  type: (typeof Type)[keyof typeof Type];
  nullable?: boolean;
  description?: string;
  enum?: string[];
  properties?: Record<string, GeminiSchemaNode>;
  items?: GeminiSchemaNode;
  required?: string[];
};

function translateSchema(node: JsonSchemaNode): GeminiSchemaNode {
  const typeMap: Record<string, (typeof Type)[keyof typeof Type]> = {
    object: Type.OBJECT,
    array: Type.ARRAY,
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
  };

  const result: GeminiSchemaNode = {
    type: typeMap[node.type] ?? Type.STRING,
  };

  if (node.nullable) result.nullable = true;
  if (node.description) result.description = node.description;
  if (node.enum) result.enum = node.enum;

  if (node.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      result.properties[key] = translateSchema(value);
    }
  }

  if (node.items) result.items = translateSchema(node.items);
  if (node.required) result.required = node.required;

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration (ms) to ban a model after a 429/503 — short enough for fast recovery */
const CIRCUIT_BREAKER_DURATION_MS = 30_000;

/**
 * Whether a discovered Gemini model can use the `googleSearch` tool.
 *
 * The list-models API says nothing about tool support, so this is derived:
 * the registry is authoritative for models we route to, and everything else
 * falls back to a family rule — the general-purpose `gemini-*` text models
 * take the `googleSearch` tool, and the specialist families do not.
 *
 * Excluded, and why: the open-weight Gemma and Lyria families and the
 * `deep-research-*` / `antigravity-*` agents are not `gemini-*` at all; and
 * within `gemini-*`, the embedding, image, video, speech, live-session,
 * retrieval (AQA), robotics, and computer-use variants are built for a
 * different job and reject or ignore a search tool.
 *
 * Getting this wrong in the permissive direction is what put non-grounding
 * models in the web-research dropdown, where picking one produced a setting
 * that saved cleanly and then failed on the first research call.
 */
function supportsGrounding(modelId: string): boolean {
  const known = getModelConfig(modelId);
  if (known) return known.supportsGrounding;
  if (!/^gemini-/i.test(modelId)) return false;
  return !/embedding|image|veo|tts|audio|live|aqa|robotics|computer-use/i.test(
    modelId,
  );
}

// ---------------------------------------------------------------------------
// Gemini Adapter (Smart Mesh v1.2)
// ---------------------------------------------------------------------------

export class GeminiAdapter implements AIProvider {
  readonly name = "Gemini";
  private client: GoogleGenAI;
  private apiKey: string;
  private aiTier: AITier;

  // Routing infrastructure (shared across all generate() calls)
  private tracker: QuotaTracker;
  private router: SmartRouter;
  private circuitBreakers = new Set<string>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: { retryOptions: { attempts: 1 } },
    });

    // Read tier from environment once at construction time
    this.aiTier = getAITier();
    const groundingLimit = getGroundingRPDLimit(this.aiTier);

    this.tracker = new QuotaTracker(groundingLimit);
    this.router = new SmartRouter(this.tracker, this.aiTier);

    log.info(
      "GeminiAdapter",
      `Initialized with AI_TIER=${this.aiTier} | Grounding RPD limit: ${groundingLimit}`,
    );
  }

  /**
   * Expose full routing diagnostics for the /api/ai/diagnostics endpoint.
   * Returns quota snapshot, circuit breaker state, and active tier — all
   * in one call to keep the diagnostics surface minimal.
   */
  readonly supportsSearchGrounding = true;

  /**
   * The model the SmartRouter settles on for a class when nothing is rate
   * limited. Under load the router may fall back to another model in the
   * same class — this is the steady-state answer the settings UI shows.
   */
  defaultModelFor(modelClass: ModelClass): string | undefined {
    return previewModelForClass(
      modelClass,
      this.aiTier,
      // The "pro" class is what research runs on, and research always needs
      // the googleSearch tool.
      modelClass === "pro",
    );
  }

  /**
   * Enumerate models from the REST list endpoint.
   *
   * Uses fetch rather than the SDK because the REST response carries
   * `supportedGenerationMethods`, which tells us *declaratively* whether a
   * model does generation or embeddings — no name guessing needed.
   */
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(
          `Gemini list-models failed: ${response.status} ${response.statusText}`,
        );
      }
      const body = (await response.json()) as {
        models?: {
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
          inputTokenLimit?: number;
        }[];
        nextPageToken?: string;
      };

      for (const model of body.models ?? []) {
        const methods = model.supportedGenerationMethods ?? [];
        const id = model.name.replace(/^models\//, "");
        const capabilities: ModelCapability[] = [];
        if (methods.includes("generateContent")) capabilities.push("chat");
        if (methods.includes("embedContent")) capabilities.push("embeddings");
        if (capabilities.length === 0) continue;
        if (capabilities.includes("chat") && supportsGrounding(id)) {
          capabilities.push("grounding");
        }
        models.push({
          // Strip the "models/" prefix — requests use the bare id.
          id,
          label: model.displayName ?? model.name,
          capabilities,
          capabilityConfidence: "declared",
          contextWindow: model.inputTokenLimit,
        });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);

    return models;
  }

  /** Embeddings via the Gemini embedding models. */
  async embed(texts: string[], model: string): Promise<number[][]> {
    const response = await this.client.models.embedContent({
      model,
      // Each text must be its own Content. Passing `contents: texts` reads as
      // ONE content with many parts and yields a single merged vector — which
      // silently under-fills the batch instead of erroring.
      contents: texts.map((text) => ({ parts: [{ text }] })),
    });
    return (response.embeddings ?? []).map((e) => e.values as number[]);
  }

  getQuotaSnapshot(): DiagnosticsSnapshot {
    return {
      ...this.tracker.getSnapshot(),
      aiTier: this.aiTier,
      circuitBreakers: [...this.circuitBreakers],
    };
  }

  // ---------------------------------------------------------------------------
  // Public API — AIProvider.generate()
  // ---------------------------------------------------------------------------

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    options.signal?.throwIfAborted();
    const startMs = Date.now();
    const requiresGrounding = !!options.enableSearchGrounding;
    const estimatedTokens = this.tracker.estimateTokens(
      options.prompt,
      options.systemPrompt,
      options.responseFormat === "json",
    );
    return withRetry(
      async () => {
        options.signal?.throwIfAborted();
        if (requiresGrounding && !this.tracker.hasGroundingCapacity())
          throw new AppError("Grounding quota exhausted for today.", 429, {
            code: "AI_BUSY",
          });
        const model =
          options.model ??
          this.router.getNextAvailableRoute(
            estimatedTokens,
            options.routing,
            this.circuitBreakers,
            requiresGrounding,
          ).modelId;
        const config = getModelConfig(model);
        if (
          options.model &&
          config &&
          !this.tracker.hasCapacity(
            model,
            estimatedTokens,
            this.aiTier === "FREE" ? config.freeLimits : config.paidLimits,
          )
        )
          throw new AppError(
            "This model has reached its local quota limit. Try again shortly.",
            429,
            { code: "AI_BUSY" },
          );
        const reservation = this.tracker.reserve(model, estimatedTokens);
        const groundingDate = requiresGrounding
          ? this.tracker.reserveGrounding()
          : undefined;
        try {
          const result = await this.executeWithModel(options, model, startMs);
          this.tracker.reconcile(
            model,
            estimatedTokens,
            result.tokenCount ?? estimatedTokens,
            reservation,
          );
          return result;
        } catch (error) {
          const status =
            (error as { status?: number; statusCode?: number })?.status ??
            (error as { statusCode?: number })?.statusCode;
          // Only explicit rejections prove that the provider did not execute the request.
          if (status && [400, 401, 403, 404, 422, 429].includes(status)) {
            this.tracker.rollback(model, reservation);
            if (requiresGrounding)
              this.tracker.rollbackGrounding(groundingDate);
          }
          options.signal?.throwIfAborted();
          if (isRetryableError(error, false) && !options.model) {
            this.circuitBreakers.add(model);
            setTimeout(
              () => this.circuitBreakers.delete(model),
              CIRCUIT_BREAKER_DURATION_MS,
            ).unref();
          }
          throw error;
        }
      },
      { signal: options.signal },
    );
  }

  // ---------------------------------------------------------------------------
  // Internal — Execute a single API call against a specific model
  // ---------------------------------------------------------------------------
  // Shared by both routed and explicit-model codepaths.
  // Contains the actual Gemini SDK call and response normalization.
  // ---------------------------------------------------------------------------

  private async executeWithModel(
    options: AIGenerateOptions,
    model: string,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const config: Record<string, unknown> = {};
    if (options.maxOutputTokens)
      config.maxOutputTokens = options.maxOutputTokens;

    if (options.enableSearchGrounding) {
      // ⚠️ Gemini API constraint: googleSearch tool is incompatible with
      // responseSchema. Must use text output for grounded retrieval.
      // The TwoPassStrategy in aiSearch handles schema extraction separately.
      config.tools = [{ googleSearch: {} }];
      config.responseMimeType = "text/plain";
    } else if (options.responseFormat === "json") {
      config.responseMimeType = "application/json";
      if (options.jsonSchema) {
        config.responseSchema = translateSchema(options.jsonSchema);
      }
    } else {
      config.responseMimeType = "text/plain";
    }

    // Use native systemInstruction when a systemPrompt is provided.
    // This gives the model a much cleaner signal than concatenating
    // [SYSTEM]...[USER] markers into the prompt text, and saves tokens.
    if (options.systemPrompt) {
      config.systemInstruction = options.systemPrompt;
    }

    // Forward cancellation to the SDK and bound callers even if the transport stalls.
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;
    const response = await withTimeout(
      async (abortSignal) =>
        this.client.models.generateContent({
          model,
          contents: options.prompt,
          config: { ...config, abortSignal },
        }),
      timeoutMs,
      options.signal,
    );

    const text = response.text ?? "";
    const tokenCount = response.usageMetadata?.totalTokenCount;
    const latencyMs = Date.now() - startMs;

    // Validate JSON at the adapter boundary so downstream callers never
    // crash on `JSON.parse` of a malformed model response. We deliberately
    // do this for routed AND explicit-model paths so behavior is uniform.
    if (options.responseFormat === "json" && !options.enableSearchGrounding) {
      parseAIJson(text, `GeminiAdapter.executeWithModel(${model})`);
    }

    const citations = response.candidates
      ?.flatMap(
        (candidate) =>
          candidate.groundingMetadata?.groundingChunks?.flatMap((chunk) =>
            chunk.web?.uri && /^https?:\/\//i.test(chunk.web.uri)
              ? [
                  {
                    title: chunk.web.title ?? chunk.web.uri,
                    uri: chunk.web.uri,
                  },
                ]
              : [],
          ) ?? [],
      )
      .slice(0, 30);
    return { text, model, tokenCount, latencyMs, citations };
  }
}
