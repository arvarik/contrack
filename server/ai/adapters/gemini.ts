// The Gemini adapter, the only file that imports `@google/genai`. The rest of
// the AI layer programs against AIProvider.
//
// Routing: the SmartRouter picks the model for a class, a circuit breaker
// pauses a model that answered 429, 5xx or timed out, for as long as Google
// asks, and the retry goes to the next model. The QuotaTracker only counts what
// was sent, for the Health page.

import {
  GoogleGenAI,
  Type,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
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
  getModelConfig,
  previewModelForClass,
  type ModelClass,
} from "../routing/registry.ts";
import { extractGeneration } from "../modelFilter.ts";
import { log } from "../../utils/logger.ts";
import {
  withTimeout,
  parseAIJson,
  AI_DEFAULTS,
  withRetry,
  isRetryableError,
  inOnePiece,
  streamWithFallback,
} from "../resilience.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import type { EmbedUse } from "../embedder.ts";

/** The Gemini task type for each embedding use. */
const GEMINI_TASK_TYPES: Record<EmbedUse, string> = {
  query: "RETRIEVAL_QUERY",
  document: "RETRIEVAL_DOCUMENT",
  similarity: "SEMANTIC_SIMILARITY",
};

// JSON Schema translation: a JsonSchemaNode tree into Gemini's `Type.*` schema.

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

// Constants

/** How long a model sits out after a 429, 5xx or timeout, when Google names no delay. */
const CIRCUIT_BREAKER_DURATION_MS = 30_000;

/** Bounds on the delay Google asks for, so a malformed hint cannot pause a model for a day. */
const MIN_PAUSE_MS = 5_000;
const MAX_PAUSE_MS = 15 * 60_000;

/**
 * How long to pause a model after `error`. A Gemini 429 carries a
 * `google.rpc.RetryInfo` detail, `"retryDelay": "37s"`: Google's own answer to
 * when the model takes requests again.
 */
export function pauseForError(error: unknown): number {
  const match = getErrorMessage(error).match(
    /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/,
  );
  if (!match) return CIRCUIT_BREAKER_DURATION_MS;
  const ms = Math.round(Number(match[1]) * 1000);
  return Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, ms));
}

/**
 * The thinking level to ask a model for, or undefined for its default.
 *
 * Gemini counts thinking tokens against `maxOutputTokens`. At the default level
 * 3.8 Flash thought for about 1,800 tokens on the research prompt, hit a
 * 2,500-token cap with `MAX_TOKENS` and never searched, and 3.1 Pro did the
 * same. So deep and grounded work runs at "low", which every 3.x model takes.
 * Flash-Lite already defaults to "minimal", and 2.5 models take a thinking
 * budget, not a level, so both are left alone.
 */
export function thinkingLevelFor(
  model: string,
  modelClass: ModelClass | undefined,
  grounded: boolean,
  requested?: "low" | "medium" | "high",
): "low" | "medium" | "high" | undefined {
  const config = getModelConfig(model);
  const generation = config?.generation ?? extractGeneration(model) ?? 0;
  if (generation < 3) return undefined;
  // A caller that asks for a level gets it. On the research prompt, Gemini 3.8
  // Flash searched 0 of 3 times at "low", so contact research asks for
  // "medium" with a 16,384-token budget. providerSearch.ts says why not
  // "high".
  if (requested) return requested;
  const cls = config?.modelClass ?? modelClass;
  if (!grounded && cls === "lite") return undefined;
  if (/flash-lite/i.test(model) && !grounded) return undefined;
  return "low";
}

/**
 * True when a Gemini error names a free-tier quota, such as
 * `generate_content_free_tier_requests`. Google does not say a key's tier any
 * other way.
 */
export function isFreeTierError(error: unknown): boolean {
  return /free_tier|FreeTier/.test(getErrorMessage(error));
}

/**
 * The tokens billed as input and as output. The search results Gemini read
 * count as input, and its thinking is billed as output.
 */
function usageOf(
  metadata: GenerateContentResponseUsageMetadata | undefined,
): AIGenerateResult["usage"] {
  if (!metadata) return undefined;
  return {
    inputTokens:
      (metadata.promptTokenCount ?? 0) +
      (metadata.toolUsePromptTokenCount ?? 0),
    outputTokens:
      (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
  };
}

/**
 * Whether a discovered Gemini model can use the `googleSearch` tool. The
 * list-models API says nothing about tools, so the registry decides for models
 * it knows, and a family rule for the rest: general-purpose `gemini-*` text
 * models take the tool. Gemma, Lyria and the `deep-research-*` /
 * `antigravity-*` agents are not `gemini-*`, and the embedding, image, video,
 * speech, live, retrieval (AQA), robotics and computer-use variants reject or
 * ignore a search tool. Erring permissive would offer a model in the research
 * picker that saves cleanly and fails on the first run.
 */
function supportsGrounding(modelId: string): boolean {
  const known = getModelConfig(modelId);
  if (known) return known.supportsGrounding;
  if (!/^gemini-/i.test(modelId)) return false;
  return !/embedding|image|veo|tts|audio|live|aqa|robotics|computer-use/i.test(
    modelId,
  );
}

// The adapter

export class GeminiAdapter implements AIProvider {
  readonly name = "Gemini";
  readonly supportsSearchGrounding = true;
  private client: GoogleGenAI;
  private apiKey: string;

  // Routing infrastructure (shared across all generate() calls)
  private tracker = new QuotaTracker();
  private router = new SmartRouter();
  private circuitBreakers = new Set<string>();
  /** Set once Google answers with a free-tier quota error. */
  private freeTier = false;
  /** Models that refused a thinking level, so none is sent again. */
  private noThinkingLevel = new Set<string>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: { retryOptions: { attempts: 1 } },
    });
  }

  /**
   * The model the SmartRouter settles on for a class when nothing is paused,
   * shown in Settings. Under load the router may fall back to another model of
   * the class.
   */
  defaultModelFor(
    modelClass: ModelClass,
    options: { grounding?: boolean } = {},
  ): string | undefined {
    return previewModelForClass(modelClass, options.grounding ?? false);
  }

  /** Take a model out of rotation for `ms`, after which it is tried again. */
  private pause(model: string, ms: number): void {
    this.circuitBreakers.add(model);
    setTimeout(() => this.circuitBreakers.delete(model), ms).unref();
  }

  /**
   * The bookkeeping after a failed call. A request Google refused is not
   * counted, a free-tier quota is noted, and a routed model sits out so the
   * retry picks another. A canceled call says nothing about the model.
   */
  private recordFailure(
    error: unknown,
    model: string,
    reservation: number,
    options: AIGenerateOptions,
    groundingDate?: string,
  ): void {
    const status =
      (error as { status?: number; statusCode?: number })?.status ??
      (error as { statusCode?: number })?.statusCode;
    // Only explicit rejections prove that the provider did not execute the request.
    if (status && [400, 401, 403, 404, 422, 429].includes(status)) {
      this.tracker.rollback(model, reservation);
      if (groundingDate) this.tracker.rollbackGrounding(groundingDate);
    }
    if (status === 429 && isFreeTierError(error) && !this.freeTier) {
      this.freeTier = true;
      log.warn(
        "GeminiAdapter",
        "Google answered with a free-tier quota. On the free tier Google may use prompts and responses to improve its products. A key from a Cloud project with billing keeps them out.",
      );
    }
    if (options.signal?.aborted) return;
    // A pinned model is the caller's choice, so there is nothing to
    // route around. A routed one sits out and the retry picks another.
    if (isRetryableError(error, false) && !options.model) {
      this.pause(model, pauseForError(error));
    }
  }

  /**
   * List models from the REST endpoint, not the SDK, because its
   * `supportedGenerationMethods` says whether a model generates or embeds, with
   * no name guessing.
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
        // Gemini 1.x and 2.x are listed but answer a new project with 404 "no
        // longer available to new users", so they are not offered for chat.
        if (methods.includes("generateContent") && !/^gemini-[12]\./.test(id))
          capabilities.push("chat");
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

  /**
   * Embeddings through the Gemini embedding models. Each use is a task type.
   * With gemini-embedding-001 the retrieval types lift dense MRR on the search
   * gate's corpus from 0.858 to 0.899, and on the dedupe corpus
   * SEMANTIC_SIMILARITY lifts a duplicate's partner from 0.809 to 0.892 MRR,
   * where RETRIEVAL_DOCUMENT lowers it to 0.756. gemini-embedding-2 answers the
   * same either way. A call with no use sends none.
   */
  async embed(
    texts: string[],
    model: string,
    use?: EmbedUse,
  ): Promise<number[][]> {
    const response = await this.client.models.embedContent({
      model,
      // Each text must be its own Content: `contents: texts` reads as one
      // content with many parts and returns one merged vector, a short batch
      // with no error.
      contents: texts.map((text) => ({ parts: [{ text }] })),
      ...(use ? { config: { taskType: GEMINI_TASK_TYPES[use] } } : {}),
    });
    return (response.embeddings ?? []).map((e) => e.values as number[]);
  }

  getQuotaSnapshot(): DiagnosticsSnapshot {
    return {
      ...this.tracker.getSnapshot(),
      circuitBreakers: [...this.circuitBreakers],
      freeTier: this.freeTier,
    };
  }

  // AIProvider.generate()

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
        const model =
          options.model ??
          this.router.getNextAvailableRoute(
            options.routing,
            this.circuitBreakers,
            requiresGrounding,
          ).modelId;
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
          this.recordFailure(error, model, reservation, options, groundingDate);
          options.signal?.throwIfAborted();
          throw error;
        }
      },
      { signal: options.signal },
    );
  }

  // AIProvider.generateStream()

  /**
   * The same call, streamed: `onDelta` gets each piece of text as Gemini sends
   * it. A JSON or grounded call is not streamed: it runs `generate` and sends
   * the text as one piece. A stream that fails before its first piece falls
   * back to `generate`, which retries on another model. After the first piece a
   * failure is thrown, because a sent piece cannot be taken back.
   */
  async generateStream(
    options: AIGenerateOptions,
    onDelta: (text: string) => void,
  ): Promise<AIGenerateResult> {
    if (options.responseFormat !== "text" || options.enableSearchGrounding)
      return inOnePiece(() => this.generate(options), onDelta);
    return streamWithFallback(
      (onPiece) => this.streamOnce(options, onPiece),
      () => this.generate(options),
      onDelta,
      { signal: options.signal, area: "GeminiAdapter", subject: "stream" },
    );
  }

  /** One streamed call, routed and counted like an attempt of `generate`. */
  private async streamOnce(
    options: AIGenerateOptions,
    send: (piece: string) => void,
  ): Promise<AIGenerateResult> {
    options.signal?.throwIfAborted();
    const startMs = Date.now();
    const model =
      options.model ??
      this.router.getNextAvailableRoute(
        options.routing,
        this.circuitBreakers,
        false,
      ).modelId;
    const estimatedTokens = this.tracker.estimateTokens(
      options.prompt,
      options.systemPrompt,
    );
    const reservation = this.tracker.reserve(model, estimatedTokens);
    try {
      const result = await withTimeout(
        (signal) => this.streamWithModel(options, model, signal, startMs, send),
        options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs,
        options.signal,
      );
      this.tracker.reconcile(
        model,
        estimatedTokens,
        result.tokenCount ?? estimatedTokens,
        reservation,
      );
      return result;
    } catch (error) {
      this.recordFailure(error, model, reservation, options);
      throw error;
    }
  }

  // One API call against one model, for the routed and explicit-model paths
  // alike: the SDK call and the response normalization.

  private async executeWithModel(
    options: AIGenerateOptions,
    model: string,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const config = this.configFor(options, model);

    // Forward cancellation to the SDK and bound callers even if the transport stalls.
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;
    const response = await this.withThinkingLevel(model, config, () =>
      withTimeout(
        async (abortSignal) =>
          this.client.models.generateContent({
            model,
            contents: options.prompt,
            config: { ...config, abortSignal },
          }),
        timeoutMs,
        options.signal,
      ),
    );

    let text = response.text ?? "";
    const metadata = response.usageMetadata;
    const tokenCount = metadata?.totalTokenCount;
    const usage = usageOf(metadata);
    const latencyMs = Date.now() - startMs;

    // Validate JSON here, on both paths, so no caller crashes on `JSON.parse`
    // of a malformed answer, and hand back the parsed value re-serialized,
    // without a fence or a stray sentence.
    if (options.responseFormat === "json" && !options.enableSearchGrounding) {
      text = JSON.stringify(
        parseAIJson(text, `GeminiAdapter.executeWithModel(${model})`),
      );
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
    // The searches Gemini chose to run. A grounded answer that cites nothing
    // still lists them, which tells "searched and found nobody" apart from
    // "answered without searching".
    const searchQueries = [
      ...new Set(
        response.candidates?.flatMap(
          (candidate) => candidate.groundingMetadata?.webSearchQueries ?? [],
        ) ?? [],
      ),
    ];
    // Which pages back which passage: the dossier links each fact to its page
    // from these, even when the answer forgot to name the site.
    const supports =
      response.candidates?.flatMap((candidate) => {
        const chunks = candidate.groundingMetadata?.groundingChunks ?? [];
        return (candidate.groundingMetadata?.groundingSupports ?? []).flatMap(
          (support) => {
            const passage = support.segment?.text?.trim();
            const uris = (support.groundingChunkIndices ?? [])
              .map((index) => chunks[index]?.web?.uri)
              .filter(
                (uri): uri is string => !!uri && /^https?:\/\//i.test(uri),
              );
            return passage && uris.length > 0
              ? [{ text: passage.slice(0, 600), uris }]
              : [];
          },
        );
      }) ?? [];
    return {
      text,
      model,
      tokenCount,
      ...(usage && { usage }),
      latencyMs,
      citations,
      ...(searchQueries.length > 0 && { searchQueries }),
      ...(supports.length > 0 && { supports }),
    };
  }

  /** Stream a text call on `model` and send each piece of text as it comes. */
  private async streamWithModel(
    options: AIGenerateOptions,
    model: string,
    signal: AbortSignal,
    startMs: number,
    send: (piece: string) => void,
  ): Promise<AIGenerateResult> {
    const config = this.configFor(options, model);
    const stream = await this.withThinkingLevel(model, config, () =>
      this.client.models.generateContentStream({
        model,
        contents: options.prompt,
        config: { ...config, abortSignal: signal },
      }),
    );

    let text = "";
    let metadata: GenerateContentResponseUsageMetadata | undefined;
    for await (const chunk of stream) {
      // The caller or the timeout ended the call, so no piece goes out.
      signal.throwIfAborted();
      metadata = chunk.usageMetadata ?? metadata;
      const piece = chunk.text;
      if (!piece) continue;
      text += piece;
      send(piece);
    }

    // The last chunk carries the usage of the whole call.
    const tokenCount = metadata?.totalTokenCount;
    const usage = usageOf(metadata);
    const latencyMs = Date.now() - startMs;
    log.info(
      "GeminiAdapter",
      `${model} (stream) | ${latencyMs}ms | ${tokenCount ?? "?"} tokens`,
    );
    return { text, model, tokenCount, ...(usage && { usage }), latencyMs };
  }

  /** The request config for `options` on `model`, without the abort signal. */
  private configFor(
    options: AIGenerateOptions,
    model: string,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (options.maxOutputTokens)
      config.maxOutputTokens = options.maxOutputTokens;

    const thinkingLevel = this.noThinkingLevel.has(model)
      ? undefined
      : thinkingLevelFor(
          model,
          options.routing?.prefer,
          !!options.enableSearchGrounding,
          options.thinkingLevel,
        );
    if (thinkingLevel) config.thinkingConfig = { thinkingLevel };

    if (options.enableSearchGrounding) {
      // Gemini cannot combine the googleSearch tool with responseSchema, so
      // grounded calls return text. Research extracts into the schema in a call
      // of its own (server/services/research/extract.ts).
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

    // A native systemInstruction, a cleaner signal than [SYSTEM]...[USER]
    // markers in the prompt, and fewer tokens.
    if (options.systemPrompt) {
      config.systemInstruction = options.systemPrompt;
    }
    return config;
  }

  /**
   * Send a request, and send it again with no thinking level when the model
   * refuses the one in `config`.
   */
  private async withThinkingLevel<T>(
    model: string,
    config: Record<string, unknown>,
    send: () => Promise<T>,
  ): Promise<T> {
    try {
      return await send();
    } catch (err) {
      // A model that takes no thinking level says so in a 400. Send it none,
      // now and from then on.
      if (!config.thinkingConfig || !/thinking/i.test(getErrorMessage(err)))
        throw err;
      this.noThinkingLevel.add(model);
      delete config.thinkingConfig;
      log.info("GeminiAdapter", `${model} takes no thinking level`);
      return send();
    }
  }
}
