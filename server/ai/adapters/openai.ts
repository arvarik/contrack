// =============================================================================
// AI Layer — Concrete OpenAI Adapter
// =============================================================================
// This is the ONLY file in the codebase that imports from `openai`.
// All OpenAI SDK coupling is contained here. The rest of the AI layer
// programs against the abstract AIProvider interface.
//
// Resiliency (Phase 2 backend refactor):
// - Per-attempt timeout via AbortSignal, propagated to the SDK call so the
//   socket is actually torn down (not just abandoned).
// - Exponential backoff + jitter on transient failures (5xx/429/timeout/
//   socket reset).
// - Tolerant JSON validation when responseFormat === "json", normalised so
//   the text callers get back always parses.
// - Caller-cancellation: if the request's AbortSignal aborts, no further
//   retries are attempted and an AppError(code: CANCELLED) is thrown.
// =============================================================================

import OpenAI from "openai";
import type { AIProvider, ModelInfo, ModelCapability } from "../provider.ts";
import type { ModelClass } from "../routing/registry.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
} from "../types.ts";
import { getLatestDiscoveredModel } from "../modelFilter.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { toCitations, type RawSource } from "../citations.ts";
import {
  translateSchemaNode as translateSchema,
  withObjectRoot,
  type TranslateOptions,
} from "../schemaTranslation.ts";
import {
  withTimeout,
  withRetry,
  parseAIJson,
  AI_DEFAULTS,
} from "../resilience.ts";

// ---------------------------------------------------------------------------
// Model Class Mapping
// ---------------------------------------------------------------------------

// The fallback when discovery has not run. GPT-6 names its tiers Astra (the
// flagship, $10/$50 per 1M tokens), Sol (the middle, $2/$10) and Luna (the
// cheap one, $0.10/$0.50). Discovery overrides these with the newest model of
// each tier the key can see.
const MODEL_MAP: Record<ModelClass, string> = {
  lite: "gpt-6-luna",
  flash: "gpt-6-sol",
  pro: "gpt-6-astra",
};

const DEFAULT_MODEL_CLASS: ModelClass = "lite";

/**
 * Whether a model can use the Responses API `web_search` tool, which is how
 * this adapter grounds research.
 *
 * OpenAI's list endpoint returns bare ids with no capability metadata at all,
 * so like the chat/embeddings split above this is a name rule — and like that
 * split it is reported with "guessed" confidence. Web search is available on
 * the GPT-4o and later flagship families and the o-series reasoning models;
 * the legacy 3.5 and instruct families cannot use tools this way.
 */
function supportsWebSearch(modelId: string): boolean {
  return /^(gpt-4o|gpt-4\.1|gpt-[5-9]|o[3-9])/i.test(modelId);
}

/**
 * Ids /v1/models lists that a chat call cannot use, or should not.
 *
 * Tested against the live API on 2026-09-26: the codex and `*-chat-latest`
 * aliases answer 404 "deprecated" (shut down in July and August 2026), the
 * `-pro` models and `gpt-live-1` answer "not a chat model", and search,
 * realtime, audio, image and moderation models are other products. Offering
 * any of them in a dropdown produced a pin that failed on its first call.
 */
const NOT_FOR_CHAT =
  /whisper|tts|dall-e|sora|moderation|transcribe|realtime|audio|image|codex|chat-latest|^chat-|-pro\b|-pro-|\blive\b|-live|search|instruct|davinci|babbage/i;

// ---------------------------------------------------------------------------
// Reasoning effort
// ---------------------------------------------------------------------------

/** The values the API takes, lowest first. */
const EFFORT_LADDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type Effort = (typeof EFFORT_LADDER)[number];

/**
 * The effort each class asks for. GPT-5.6 and GPT-6 reason at `medium` when
 * told nothing, which spends hidden tokens on a one-line summary and pushes
 * query planning past its 4-second budget. Quick work asks for none.
 */
const EFFORT_FOR_CLASS: Record<ModelClass, Effort> = {
  lite: "none",
  flash: "low",
  pro: "medium",
};

/** Web research plans its searches, so it never runs below this. */
const GROUNDED_EFFORT_FLOOR: Effort = "low";

/**
 * With reasoning on, `max_completion_tokens` covers the hidden reasoning as
 * well as the answer. A 200-token cap then returns an empty string with
 * finish_reason "length" (seen on gpt-5-nano, o3-mini and o4-mini), so a
 * call that reasons gets at least this much room.
 */
const REASONING_TOKEN_FLOOR = 2_048;

const atLeast = (a: Effort, b: Effort): Effort =>
  EFFORT_LADDER.indexOf(a) >= EFFORT_LADDER.indexOf(b) ? a : b;

/**
 * Read a rejected effort's error. `unsupported_value` names the values the
 * model takes ("Supported values are: 'low', 'medium', 'high', and
 * 'xhigh'."); a model that predates reasoning answers "Unrecognized request
 * argument supplied: reasoning_effort". Anything else is not about effort.
 */
function effortCorrection(
  error: unknown,
  asked: Effort,
): Effort | "omit" | null {
  const message = getErrorMessage(error);
  if (!/reasoning[._ ]?effort/i.test(message)) return null;
  if (/unrecognized request argument|unknown parameter/i.test(message))
    return "omit";
  const supported = [...message.matchAll(/'([a-z]+)'/g)]
    .map((m) => m[1])
    .filter((v): v is Effort =>
      (EFFORT_LADDER as readonly string[]).includes(v),
    )
    .filter((v) => v !== asked);
  if (supported.length === 0) return "omit";
  const sorted = supported.sort(
    (a, b) => EFFORT_LADDER.indexOf(a) - EFFORT_LADDER.indexOf(b),
  );
  return (
    sorted.find(
      (v) => EFFORT_LADDER.indexOf(v) >= EFFORT_LADDER.indexOf(asked),
    ) ?? sorted[sorted.length - 1]
  );
}

// ---------------------------------------------------------------------------
// Schema Translation — shared translator, OpenAI dialect (nullable→anyOf)
// ---------------------------------------------------------------------------

const SCHEMA_DIALECT: TranslateOptions = {
  nullableStyle: "anyOf",
  sealObjects: "with-properties",
};

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  return translateSchema(node, SCHEMA_DIALECT);
}

/** A Responses API source: the URL is all OpenAI returns for one. */
type ResponsesSource = RawSource;

// ---------------------------------------------------------------------------
// OpenAI Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements AIProvider {
  readonly name = "OpenAI";
  readonly supportsSearchGrounding = true;
  private client: OpenAI;
  /**
   * The effort each model turned out to accept, learned from its first
   * refusal: `gpt-6-astra` refuses "none", `gpt-5-nano` wants "minimal", and
   * `gpt-4.1` takes no effort at all. Remembered so the refusal is paid once.
   */
  private learnedEffort = new Map<string, Effort | "omit">();

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 0 });
  }

  /**
   * Enumerate models. OpenAI's list endpoint returns bare ids with no
   * capability metadata, so capability is pattern-matched and the settings UI
   * exposes an override. `created` becomes `releasedAt`, so the catalog can
   * drop chat models more than a year old.
   */
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const model of this.client.models.list()) {
      const id = model.id;
      const releasedAt =
        typeof model.created === "number" ? model.created * 1000 : undefined;
      if (/^(text-)?embedding|embedding-/i.test(id)) {
        models.push({
          id,
          label: id,
          capabilities: ["embeddings"],
          capabilityConfidence: "guessed",
          releasedAt,
        });
        continue;
      }
      if (NOT_FOR_CHAT.test(id)) continue;
      if (/^(gpt|o\d)/i.test(id)) {
        const capabilities: ModelCapability[] = ["chat"];
        if (supportsWebSearch(id)) capabilities.push("grounding");
        models.push({
          id,
          label: id,
          capabilities,
          capabilityConfidence: "guessed",
          releasedAt,
        });
      }
    }
    return models;
  }

  /** OpenAI defaults to latest discovered models, falling back to static map. */
  defaultModelFor(modelClass: ModelClass): string | undefined {
    return (
      getLatestDiscoveredModel("openai", modelClass) ?? MODEL_MAP[modelClass]
    );
  }

  /** Embeddings via /v1/embeddings. */
  async embed(texts: string[], model: string): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model,
      input: texts,
    });
    return response.data.map((d) => d.embedding as number[]);
  }

  resolveModel(prefer?: string, modelOverride?: string): string {
    if (modelOverride) return modelOverride;
    const targetClass = (prefer ?? DEFAULT_MODEL_CLASS) as ModelClass;
    return (
      getLatestDiscoveredModel("openai", targetClass) ??
      MODEL_MAP[targetClass] ??
      MODEL_MAP[DEFAULT_MODEL_CLASS]
    );
  }

  /**
   * OpenAI wraps the schema in `json_schema: { name, schema }` — note this is
   * NOT the shape Anthropic uses, which takes the schema directly.
   *
   * `strict: true` is deliberately omitted. Strict mode requires `required` to
   * list every key in `properties`, and Contrack's schemas have genuinely
   * optional fields (a contact has a name; it may not have a company). Sending
   * strict with those schemas is rejected outright:
   *
   *   400 Invalid schema for response_format 'response': 'required' is required
   *   to be supplied and to be an array including every key in properties.
   *
   * Non-strict json_schema still constrains generation and accepts optional
   * fields, which is what we need.
   */
  translateSchema(schema: JsonSchemaNode): {
    type: "json_schema";
    json_schema: {
      name: string;
      schema: Record<string, unknown>;
    };
  } {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: translateSchemaNode(withObjectRoot(schema).schema),
      },
    };
  }

  /**
   * The Responses API's `text.format`, which is flat: `{ type, name, schema }`.
   *
   * The adapter used to send the Chat Completions shape here, nested under
   * `json_schema`, and every grounded research call answered 400 "Missing
   * required parameter: 'text.format.name'". The Responses API also defaults
   * to strict, unlike Chat Completions, hence the explicit `strict: false`.
   */
  translateResponsesFormat(schema: JsonSchemaNode): {
    type: "json_schema";
    name: string;
    schema: Record<string, unknown>;
    strict: false;
  } {
    return {
      type: "json_schema",
      name: "response",
      schema: translateSchemaNode(withObjectRoot(schema).schema),
      strict: false,
    };
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const model = options.model ?? this.resolveModel(options.routing?.prefer);
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;
    const unwrap = options.jsonSchema
      ? withObjectRoot(options.jsonSchema).unwrap
      : (v: unknown) => v;

    return withRetry(
      async (attempt) => {
        const startMs = Date.now();
        const result = await withTimeout(
          async (signal) => {
            return options.enableSearchGrounding
              ? this.runResponsesAPI(options, model, signal, startMs)
              : this.runChatCompletion(options, model, signal, startMs);
          },
          timeoutMs,
          options.signal,
        );

        // JSON validation lives at the adapter boundary so every business
        // caller can rely on `result.text` being parseable when requested:
        // fences and prose go, and a wrapped array root comes back an array.
        if (options.responseFormat === "json") {
          const parsed = parseAIJson(
            result.text,
            `OpenAIAdapter.generate(${model})`,
          );
          result.text = JSON.stringify(unwrap(parsed));
        }

        if (attempt > 1) {
          log.info(
            "OpenAIAdapter",
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
            "OpenAIAdapter",
            `${model} attempt ${attempt} failed (will retry): ${msg.slice(0, 200)}`,
          );
        },
      },
    );
  }

  /** The effort to ask `model` for, given the call's class and grounding. */
  private effortFor(
    model: string,
    options: AIGenerateOptions,
  ): Effort | "omit" {
    const learned = this.learnedEffort.get(model);
    if (learned) return learned;
    const wanted =
      EFFORT_FOR_CLASS[
        (options.routing?.prefer ?? DEFAULT_MODEL_CLASS) as ModelClass
      ] ?? "none";
    return options.enableSearchGrounding
      ? atLeast(wanted, GROUNDED_EFFORT_FLOOR)
      : wanted;
  }

  /**
   * Send a request with an effort, and when the model refuses the effort,
   * correct it once and send again. The correction is remembered.
   */
  private async withEffort<T>(
    model: string,
    options: AIGenerateOptions,
    send: (effort: Effort | "omit") => Promise<T>,
  ): Promise<T> {
    const effort = this.effortFor(model, options);
    try {
      return await send(effort);
    } catch (err) {
      if (effort === "omit") throw err;
      const corrected = effortCorrection(err, effort);
      if (!corrected) throw err;
      this.learnedEffort.set(model, corrected);
      log.info(
        "OpenAIAdapter",
        `${model} does not take reasoning effort "${effort}"; using ${corrected === "omit" ? "none at all" : `"${corrected}"`}`,
      );
      return send(corrected);
    }
  }

  /** The output budget: the caller's, with room for reasoning when it runs. */
  private budget(
    options: AIGenerateOptions,
    effort: Effort | "omit",
  ): number | undefined {
    const max = options.maxOutputTokens;
    if (!max) return undefined;
    // "none" does not reason, and "omit" is a model that cannot.
    const reasons = effort !== "none" && effort !== "omit";
    return reasons ? Math.max(max, REASONING_TOKEN_FLOOR) : max;
  }

  // ── Standard chat completion ──────────────────────────────────────────
  private async runChatCompletion(
    options: AIGenerateOptions,
    model: string,
    signal: AbortSignal,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (options.systemPrompt)
      messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: options.prompt });

    // Minimal local response shape — the OpenAI SDK types are unions over a dozen
    // overloads (streaming vs. non-streaming, function-calling, etc.) and TypeScript
    // can't narrow them at our call site. We assert the non-streaming branch here.
    interface ChatCompletionResponse {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { total_tokens?: number };
    }
    const response = await this.withEffort(model, options, (effort) => {
      const requestParams: Record<string, unknown> = { model, messages };
      const max = this.budget(options, effort);
      if (max) requestParams.max_completion_tokens = max;
      if (effort !== "omit") requestParams.reasoning_effort = effort;
      if (options.responseFormat === "json" && options.jsonSchema) {
        requestParams.response_format = this.translateSchema(
          options.jsonSchema,
        );
      } else if (options.responseFormat === "json") {
        requestParams.response_format = { type: "json_object" };
      }
      return this.client.chat.completions.create(
        requestParams as unknown as Parameters<
          typeof this.client.chat.completions.create
        >[0],
        { signal },
      ) as unknown as Promise<ChatCompletionResponse>;
    });

    const text = response.choices?.[0]?.message?.content ?? "";
    const tokenCount = response.usage?.total_tokens;
    const latencyMs = Date.now() - startMs;

    log.info(
      "OpenAIAdapter",
      `${model} | ${latencyMs}ms | ${tokenCount ?? "?"} tokens`,
    );
    return { text, model, tokenCount, latencyMs };
  }

  // ── Responses API with web_search tool ────────────────────────────────
  private async runResponsesAPI(
    options: AIGenerateOptions,
    model: string,
    signal: AbortSignal,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const input: Array<{ role: "system" | "user"; content: string }> = [];
    if (options.systemPrompt)
      input.push({ role: "system", content: options.systemPrompt });
    input.push({ role: "user", content: options.prompt });

    // Local response shape for the Responses API — the SDK types are too
    // permissive (output can be any of a dozen tool/message types). We model
    // only the branches we extract from.
    interface ResponsesAPIResponse {
      output?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          text?: string;
          annotations?: Array<{ type?: string; url?: string; title?: string }>;
        }>;
        action?: { sources?: ResponsesSource[] };
      }>;
      usage?: { total_tokens?: number };
    }
    const response = await this.withEffort(model, options, (effort) => {
      const requestParams: Record<string, unknown> = {
        model,
        input,
        tools: [{ type: "web_search" }],
        // Without this the pages the model read are not returned at all:
        // a JSON answer carries no inline url_citation annotations.
        include: ["web_search_call.action.sources"],
      };
      if (effort !== "omit") requestParams.reasoning = { effort };
      const max = this.budget(options, effort);
      if (max) requestParams.max_output_tokens = max;
      if (options.responseFormat === "json" && options.jsonSchema) {
        requestParams.text = {
          format: this.translateResponsesFormat(options.jsonSchema),
        };
      }
      return this.client.responses.create(
        requestParams as unknown as Parameters<
          typeof this.client.responses.create
        >[0],
        { signal },
      ) as unknown as Promise<ResponsesAPIResponse>;
    });

    let text = "";
    const cited: ResponsesSource[] = [];
    const consulted: ResponsesSource[] = [];
    for (const item of response.output ?? []) {
      if (item.type === "web_search_call")
        consulted.push(...(item.action?.sources ?? []));
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const block of item.content) {
        if (block.type !== "output_text" || typeof block.text !== "string")
          continue;
        text += block.text;
        for (const a of block.annotations ?? [])
          if (a.type === "url_citation") cited.push(a);
      }
    }

    const tokenCount = response.usage?.total_tokens;
    const latencyMs = Date.now() - startMs;
    const citations = toCitations(cited.length > 0 ? cited : consulted);

    log.info(
      "OpenAIAdapter",
      `${model} (search) | ${latencyMs}ms | ${tokenCount ?? "?"} tokens | ${citations.length} sources`,
    );
    return { text, model, tokenCount, latencyMs, citations };
  }
}
