// The Anthropic adapter, the only file that imports `@anthropic-ai/sdk`.
// Retries go through `ai/resilience.ts`: a per-attempt timeout (60 s by
// default), exponential backoff with jitter on transient failures, and caller
// cancellation through options.signal. JSON answers are validated and
// normalized, so the text callers get always parses.

import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ModelInfo, ModelCapability } from "../provider.ts";
import type { ModelClass } from "../routing/registry.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
} from "../types.ts";
import {
  getDiscoveredModelsForProvider,
  getLatestDiscoveredModel,
} from "../modelFilter.ts";
import { contentHash } from "../../utils/aiCache.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { AppError } from "../../utils/AppError.ts";
import { toCitations, type RawSource } from "../citations.ts";
import {
  withTimeout,
  withRetry,
  parseAIJson,
  AI_DEFAULTS,
} from "../resilience.ts";
import {
  translateSchemaNode as translateSchema,
  exceedsAnthropicSchemaLimits,
  type TranslateOptions,
} from "../schemaTranslation.ts";

// Model classes

// The fallback when discovery has not run. Discovery overrides each with the
// newest model of its family the key can see.
const MODEL_MAP: Record<ModelClass, string> = {
  lite: "claude-haiku-4-5",
  flash: "claude-sonnet-5",
  pro: "claude-opus-5",
};

const DEFAULT_MODEL_CLASS: ModelClass = "lite";

const DEFAULT_MAX_TOKENS = 4096;
/**
 * Research answers in a wide JSON object after reading search results, and
 * the model thinks first, so a grounded call gets at least this much room.
 */
const SEARCH_MAX_TOKENS = 8192;

/** A turn paused by the server-side tool loop is resumed at most this often. */
const MAX_CONTINUATIONS = 3;

/**
 * Searches one research call may run. With no cap Sonnet 5 kept searching a
 * well-known person: 129K tokens and 55 s of a 60 s budget. Five searches
 * fill a contact's profile, and the answer still carries its sources.
 */
const MAX_SEARCHES = 5;

/**
 * The effort each class asks for. Sonnet 5 and Opus 5 think by default, at
 * effort "high", and Opus 5.5 and Fable cannot turn thinking off at all, so
 * a one-line summary pays for deliberation it does not need. Quick and deep
 * work runs at "low". Haiku 4.5 takes no effort, and is sent none.
 */
const EFFORT_FOR_CLASS: Record<ModelClass, "low" | "medium"> = {
  lite: "low",
  flash: "low",
  pro: "medium",
};

/**
 * Whether a Claude model supports the server-side `web_search` tool. The models
 * endpoint does not report tools, so this is a family rule: every family since
 * Claude 3.5 has it, and the pre-3.5 models (`claude-2*`, `claude-instant*`,
 * the original `claude-3-{opus,sonnet,haiku}`) do not. Claude 3.5 and 3.7 are
 * spelled `claude-3-5-*` / `claude-3-7-*`, so the exclusion matches only a bare
 * major-3 family segment.
 */
function supportsWebSearch(modelId: string): boolean {
  if (/^claude-(2|instant)/i.test(modelId)) return false;
  if (/^claude-3-(opus|sonnet|haiku)/i.test(modelId)) return false;
  return /^claude-/i.test(modelId);
}

/**
 * The effort levels a model takes, from what discovery recorded (the Models
 * API declares them), else a family rule: effort arrived with Opus 4.5 and is
 * on every Opus, Sonnet and Fable since; Haiku 4.5 and Sonnet 4.5 refuse it.
 */
function effortsOf(modelId: string): string[] {
  const discovered = getDiscoveredModelsForProvider("anthropic").find(
    (m) => m.id === modelId,
  );
  if (discovered?.efforts) return discovered.efforts;
  if (/haiku|sonnet-4-5|claude-3|claude-(2|instant)/i.test(modelId)) return [];
  return ["low", "medium", "high"];
}

/** A server-side tool's result block, reduced to the fields we read. */
interface ContentBlock {
  type?: string;
  text?: string;
  citations?: Array<{ url?: string; title?: string }>;
  content?: unknown;
  name?: string;
  input?: unknown;
}

/** The web searches a response ran: its `web_search` server tool calls. */
function queriesOf(content: ContentBlock[]): string[] {
  const queries = new Set<string>();
  for (const block of content) {
    const query = (block.input as { query?: unknown } | undefined)?.query;
    if (
      block.type === "server_tool_use" &&
      block.name === "web_search" &&
      typeof query === "string"
    )
      queries.add(query);
  }
  return [...queries];
}

/** The pages a response says it read: text citations first, then results. */
function sourcesOf(content: ContentBlock[]): RawSource[] {
  const cited: RawSource[] = [];
  const results: RawSource[] = [];
  for (const block of content) {
    if (block.type === "text") cited.push(...(block.citations ?? []));
    if (block.type === "web_search_tool_result" && Array.isArray(block.content))
      results.push(
        ...(block.content as Array<{ type?: string } & RawSource>).filter(
          (r) => r.type === "web_search_result",
        ),
      );
  }
  return [...cited, ...results];
}

// Schema translation, Anthropic dialect: Claude's grammar compiler takes the
// JSON Schema type union directly and wants additionalProperties:false on every
// object node.

const SCHEMA_DIALECT: TranslateOptions = {
  nullableStyle: "type-array",
  sealObjects: "objects",
};

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  return translateSchema(node, SCHEMA_DIALECT);
}

/**
 * True when Claude refused the schema itself rather than the request. Retrying
 * the same schema always fails, so the caller must change approach instead of
 * backing off.
 */
function isSchemaComplexityError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("too many optional parameters") ||
    msg.includes("too many parameters with union types") ||
    msg.includes("grammar compilation") ||
    (msg.includes("output_config.format") && msg.includes("schema"))
  );
}

/** True when the model refused `output_config.effort`. */
function isEffortRejection(error: unknown): boolean {
  return /does not support the effort parameter|output_config\.effort/i.test(
    getErrorMessage(error),
  );
}

// The adapter

export class AnthropicAdapter implements AIProvider {
  readonly name = "Anthropic";
  readonly supportsSearchGrounding = true;
  readonly defaultMaxTokens = DEFAULT_MAX_TOKENS;
  private client: Anthropic;
  /**
   * Schemas Claude declined to compile, by model and schema hash, for the
   * grammar errors the local limit check does not predict. Remembered so the
   * retry is paid once, not per call.
   */
  private schemaTooComplex = new Set<string>();
  /** Models that answered 400 to an effort, so none is sent again. */
  private noEffort = new Set<string>();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  /**
   * List models. Anthropic reports ids, display names, release dates, context
   * windows and capabilities, and every listed model is a chat model. The
   * families without the `web_search` tool are left out of grounding rather
   * than offered to fail.
   */
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const model of this.client.models.list()) {
      const capabilities: ModelCapability[] = ["chat"];
      if (supportsWebSearch(model.id)) capabilities.push("grounding");
      const declared = model as unknown as {
        created_at?: string;
        max_input_tokens?: number;
        capabilities?: {
          effort?: Record<string, { supported?: boolean } | boolean>;
        };
      };
      const effort = declared.capabilities?.effort;
      const efforts =
        effort && effort.supported
          ? Object.entries(effort)
              .filter(
                ([level, value]) =>
                  level !== "supported" &&
                  typeof value === "object" &&
                  value?.supported,
              )
              .map(([level]) => level)
          : effort
            ? []
            : undefined;
      const releasedAt = declared.created_at
        ? Date.parse(declared.created_at)
        : undefined;
      models.push({
        id: model.id,
        label: model.display_name ?? model.id,
        capabilities,
        capabilityConfidence: "declared",
        contextWindow: declared.max_input_tokens,
        releasedAt: Number.isNaN(releasedAt) ? undefined : releasedAt,
        efforts,
      });
    }
    return models;
  }

  /** Claude defaults to latest discovered models, falling back to static map. */
  defaultModelFor(modelClass: ModelClass): string | undefined {
    return (
      getLatestDiscoveredModel("anthropic", modelClass) ?? MODEL_MAP[modelClass]
    );
  }

  resolveModel(prefer?: string, modelOverride?: string): string {
    if (modelOverride) return modelOverride;
    const targetClass = (prefer ?? DEFAULT_MODEL_CLASS) as ModelClass;
    return (
      getLatestDiscoveredModel("anthropic", targetClass) ??
      MODEL_MAP[targetClass] ??
      MODEL_MAP[DEFAULT_MODEL_CLASS]
    );
  }

  /**
   * Anthropic's `output_config.format` takes the schema directly, `{ type:
   * "json_schema", schema: {...} }`, not OpenAI's nested `json_schema: { name,
   * schema }`, which the API refuses with a 400.
   */
  translateSchema(schema: JsonSchemaNode): {
    type: "json_schema";
    schema: Record<string, unknown>;
  } {
    return {
      type: "json_schema",
      schema: translateSchemaNode(schema),
    };
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const model = options.model ?? this.resolveModel(options.routing?.prefer);
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;
    const maxTokens = options.enableSearchGrounding
      ? Math.max(options.maxOutputTokens ?? 0, SEARCH_MAX_TOKENS)
      : (options.maxOutputTokens ?? DEFAULT_MAX_TOKENS);

    return withRetry(
      async (attempt) => {
        const startMs = Date.now();
        const schemaKey = `${model}:${contentHash(JSON.stringify(options.jsonSchema ?? {}))}`;
        // Claude caps a schema at 24 optional parameters and 16 union-typed
        // ones. Contrack's contact and research schemas are wider, so they go
        // to prompt-guided JSON without a failed request.
        let useSchema =
          !!options.jsonSchema &&
          !exceedsAnthropicSchemaLimits(options.jsonSchema) &&
          !this.schemaTooComplex.has(schemaKey);
        const run = (schema: boolean) =>
          withTimeout(
            (signal) =>
              this.runMessages(
                options,
                model,
                maxTokens,
                signal,
                startMs,
                schema,
              ),
            timeoutMs,
            options.signal,
          );

        let result: AIGenerateResult;
        try {
          result = await run(useSchema);
        } catch (err) {
          if (!useSchema || !isSchemaComplexityError(err)) throw err;
          log.warn(
            "AnthropicAdapter",
            `${model} declined the response schema (${getErrorMessage(err).slice(0, 120)}); retrying with prompt-guided JSON`,
          );
          if (this.schemaTooComplex.size >= 100) this.schemaTooComplex.clear();
          this.schemaTooComplex.add(schemaKey);
          useSchema = false;
          result = await run(false);
        }

        // The text callers get parses as it stands: prompt-guided answers
        // arrive with a sentence of prose or a code fence around the JSON.
        if (options.responseFormat === "json") {
          const parsed = parseAIJson(
            result.text,
            `AnthropicAdapter.generate(${model})`,
          );
          result.text = JSON.stringify(parsed);
        }

        if (attempt > 1) {
          log.info(
            "AnthropicAdapter",
            `${model} succeeded on attempt ${attempt}/${AI_DEFAULTS.maxAttempts}`,
          );
        }
        return result;
      },
      {
        signal: options.signal,
        onRetry: (attempt, err) => {
          const msg = (err as Error)?.message ?? String(err);
          log.warn(
            "AnthropicAdapter",
            `${model} attempt ${attempt} failed (will retry): ${msg.slice(0, 200)}`,
          );
        },
      },
    );
  }

  /**
   * The same call, streamed: `onDelta` gets each piece of text as Claude sends
   * it. A JSON or grounded call is not streamed: it runs `generate` and sends
   * the text as one piece. A stream that fails before its first piece falls
   * back to `generate`, which has the retries. After the first piece a failure
   * is thrown, because a sent piece cannot be taken back.
   */
  async generateStream(
    options: AIGenerateOptions,
    onDelta: (text: string) => void,
  ): Promise<AIGenerateResult> {
    if (options.responseFormat !== "text" || options.enableSearchGrounding)
      return this.generateInOnePiece(options, onDelta);
    const model = options.model ?? this.resolveModel(options.routing?.prefer);
    let sent = false;
    try {
      return await withTimeout(
        (signal) =>
          this.streamMessages(options, model, signal, (piece) => {
            sent = true;
            onDelta(piece);
          }),
        options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs,
        options.signal,
      );
    } catch (error) {
      if (options.signal?.aborted)
        throw new AppError("AI call canceled by caller", 499, {
          code: "CANCELLED",
        });
      if (sent) throw error;
      log.warn(
        "AnthropicAdapter",
        `${model} stream failed before its first piece (will run generate): ${getErrorMessage(error).slice(0, 200)}`,
      );
      return this.generateInOnePiece(options, onDelta);
    }
  }

  /** Run `generate` and send its text as one piece. */
  private async generateInOnePiece(
    options: AIGenerateOptions,
    onDelta: (text: string) => void,
  ): Promise<AIGenerateResult> {
    const result = await this.generate(options);
    if (result.text) onDelta(result.text);
    return result;
  }

  /** The effort to send `model`, or undefined when it takes none. */
  private effortFor(
    model: string,
    options: AIGenerateOptions,
  ): string | undefined {
    if (this.noEffort.has(model)) return undefined;
    const wanted =
      EFFORT_FOR_CLASS[
        (options.routing?.prefer ?? DEFAULT_MODEL_CLASS) as ModelClass
      ] ?? "low";
    return effortsOf(model).includes(wanted) ? wanted : undefined;
  }

  private async runMessages(
    options: AIGenerateOptions,
    model: string,
    maxTokens: number,
    signal: AbortSignal,
    startMs: number,
    useSchema: boolean,
  ): Promise<AIGenerateResult> {
    let systemPrompt = options.systemPrompt ?? "";
    // Without a schema to constrain it, the model needs the shape in words.
    if (options.responseFormat === "json" && !useSchema) {
      systemPrompt += `\n\nRespond with valid JSON only — no markdown fences, no prose.`;
      if (options.jsonSchema) {
        systemPrompt += `\n\nMatch this schema:\n${JSON.stringify(
          translateSchemaNode(options.jsonSchema),
        )}`;
      }
    }

    const tools = options.enableSearchGrounding
      ? [
          {
            // The basic tool on every model. Sonnet and Opus 4.5 and later also
            // take `web_search_20260209`, which filters results with code
            // first, but on the research prompt it was five times slower for
            // the same answer: 75 s, 90K input tokens and 5 searches, against
            // 14 s, 50K and 3 (Sonnet 5). The research budget is 60 s.
            type: "web_search_20250305",
            name: "web_search",
            max_uses: MAX_SEARCHES,
          },
        ]
      : undefined;

    // Local response shape — the SDK's `Message` union (text / tool_use /
    // server_tool_use / web_search_tool_result) is too granular for our needs.
    interface ClaudeMessageResponse {
      content?: ContentBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    }

    const send = (
      messages: Array<{ role: "user" | "assistant"; content: unknown }>,
      effort: string | undefined,
    ) => {
      const requestParams: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
      };
      if (systemPrompt.trim()) requestParams.system = systemPrompt.trim();
      if (tools) requestParams.tools = tools;
      const outputConfig: Record<string, unknown> = {};
      if (effort) outputConfig.effort = effort;
      if (
        options.responseFormat === "json" &&
        options.jsonSchema &&
        useSchema
      ) {
        outputConfig.format = this.translateSchema(options.jsonSchema);
      }
      if (Object.keys(outputConfig).length > 0)
        requestParams.output_config = outputConfig;
      return this.client.messages.create(
        requestParams as unknown as Parameters<
          typeof this.client.messages.create
        >[0],
        { signal },
      ) as unknown as Promise<ClaudeMessageResponse>;
    };

    const question = { role: "user" as const, content: options.prompt };
    let effort = this.effortFor(model, options);
    let response: ClaudeMessageResponse;
    try {
      response = await send([question], effort);
    } catch (err) {
      if (!effort || !isEffortRejection(err)) throw err;
      this.noEffort.add(model);
      log.info("AnthropicAdapter", `${model} takes no effort parameter`);
      effort = undefined;
      response = await send([question], undefined);
    }

    // With a server tool, the server runs its own loop and may hand the turn
    // back unfinished (`pause_turn`). Sending the partial answer back resumes
    // it.
    const content: ContentBlock[] = [...(response.content ?? [])];
    let inputTokens = response.usage?.input_tokens ?? 0;
    let outputTokens = response.usage?.output_tokens ?? 0;
    for (
      let turn = 0;
      response.stop_reason === "pause_turn" && turn < MAX_CONTINUATIONS;
      turn++
    ) {
      log.info(
        "AnthropicAdapter",
        `${model} paused its turn; resuming (${turn + 1}/${MAX_CONTINUATIONS})`,
      );
      response = await send(
        [question, { role: "assistant", content: [...content] }],
        effort,
      );
      content.push(...(response.content ?? []));
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
    }

    let text = "";
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        text += block.text;
      }
    }

    const tokenCount = inputTokens + outputTokens;
    const latencyMs = Date.now() - startMs;
    const citations = options.enableSearchGrounding
      ? toCitations(sourcesOf(content))
      : undefined;

    log.info(
      "AnthropicAdapter",
      `${model} | ${latencyMs}ms | ${tokenCount} tokens` +
        (citations ? ` | ${citations.length} sources` : ""),
    );
    const searchQueries = options.enableSearchGrounding
      ? queriesOf(content)
      : [];
    return {
      text,
      model,
      tokenCount,
      usage: { inputTokens, outputTokens },
      latencyMs,
      citations,
      ...(searchQueries.length > 0 && { searchQueries }),
    };
  }

  /** Stream a text call, with no tools and no schema, piece by piece. */
  private async streamMessages(
    options: AIGenerateOptions,
    model: string,
    signal: AbortSignal,
    send: (piece: string) => void,
  ): Promise<AIGenerateResult> {
    const startMs = Date.now();
    // Local event shape: the fields of the three events that carry the text
    // and the usage. Thinking arrives in other deltas and is not sent.
    interface ClaudeStreamEvent {
      type?: string;
      message?: { usage?: { input_tokens?: number } };
      delta?: { type?: string; text?: string };
      usage?: { output_tokens?: number };
    }
    const open = (effort: string | undefined) => {
      const requestParams: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: options.prompt }],
        max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
      };
      const system = options.systemPrompt?.trim();
      if (system) requestParams.system = system;
      if (effort) requestParams.output_config = { effort };
      return this.client.messages.create(
        requestParams as unknown as Parameters<
          typeof this.client.messages.create
        >[0],
        { signal },
      ) as unknown as Promise<AsyncIterable<ClaudeStreamEvent>>;
    };

    // A refused effort is a 400 to the request, before any event, so the one
    // retry without it works as it does in `runMessages`.
    const effort = this.effortFor(model, options);
    let stream: AsyncIterable<ClaudeStreamEvent>;
    try {
      stream = await open(effort);
    } catch (err) {
      if (!effort || !isEffortRejection(err)) throw err;
      this.noEffort.add(model);
      log.info("AnthropicAdapter", `${model} takes no effort parameter`);
      stream = await open(undefined);
    }

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of stream) {
      // The caller or the timeout ended the call, so no piece goes out.
      signal.throwIfAborted();
      if (event.type === "message_start") {
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
      } else if (event.type === "message_delta") {
        // The count is cumulative, so the last one is the total.
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      } else if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        event.delta.text
      ) {
        text += event.delta.text;
        send(event.delta.text);
      }
    }

    const tokenCount = inputTokens + outputTokens;
    const latencyMs = Date.now() - startMs;
    log.info(
      "AnthropicAdapter",
      `${model} (stream) | ${latencyMs}ms | ${tokenCount} tokens`,
    );
    return {
      text,
      model,
      tokenCount,
      usage: { inputTokens, outputTokens },
      latencyMs,
    };
  }
}
