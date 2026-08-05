// =============================================================================
// AI Layer — Generic OpenAI-Compatible Adapter
// =============================================================================
// One adapter for every backend that speaks the OpenAI wire format:
// Ollama, vLLM, LM Studio, llama.cpp, xAI, DeepSeek, Mistral, OpenRouter…
// Providers differ only by base URL + key, so they are *configuration*,
// not code.
//
// What this adapter deliberately does NOT do:
//   - Search grounding. No standard exists in the compat surface; the
//     SearXNG research strategy covers self-hosted grounding instead.
//   - Quota tracking / SmartRouter. Those are Gemini-specific.
//
// Structured output is adaptive: strict `json_schema` is attempted first and
// the adapter downgrades (per model, remembered) to `json_object` and then to
// prompt-only instructions when a backend rejects the richer forms. Many
// local servers support only the simpler modes.
// =============================================================================

import OpenAI from "openai";
import type { AIProvider, ModelInfo } from "../provider.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
} from "../types.ts";
import { log } from "../../utils/logger.ts";
import { AppError } from "../../utils/AppError.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  withTimeout,
  withRetry,
  parseAIJson,
  AI_DEFAULTS,
} from "../resilience.ts";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  label?: string;
}

/** How structured output is expressed for a given model. */
type JsonMode = "json_schema" | "json_object" | "prompt";

/** A backend that can't honor the requested response_format says so in a 400. */
function isFormatRejection(message: string): boolean {
  return /response_format|json_schema|not supported|unsupported|invalid.*format/i.test(
    message,
  );
}

/** Would the caller be able to parse this body? Fences are tolerated. */
function isParseableJson(text: string): boolean {
  if (!text?.trim()) return false;
  try {
    parseAIJson(text, "openaiCompatible.probe");
    return true;
  } catch {
    return false;
  }
}

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (node.nullable) {
    return { anyOf: [{ type: node.type }, { type: "null" }] };
  }
  result.type = node.type;
  if (node.enum) result.enum = node.enum;
  if (node.description) result.description = node.description;
  if (node.properties) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = translateSchemaNode(value);
    }
    result.properties = properties;
    result.additionalProperties = false;
  }
  if (node.items) result.items = translateSchemaNode(node.items);
  if (node.required) result.required = node.required;
  return result;
}

export class OpenAICompatibleAdapter implements AIProvider {
  readonly name: string;
  readonly supportsSearchGrounding = false;
  private client: OpenAI;
  private baseUrl: string;
  /** Remembered JSON-mode downgrades, keyed by model id. */
  private jsonModes = new Map<string, JsonMode>();

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.label || "OpenAI-Compatible";
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      // Local servers (Ollama, LM Studio) ignore the key but the SDK requires
      // a non-empty string.
      apiKey: options.apiKey || "not-needed",
    });
  }

  /**
   * Models exposed by the endpoint. Compat servers return bare ids, so
   * capability is guessed from the name and refined by the user in settings.
   */
  async listModels(): Promise<ModelInfo[]> {
    const response = await this.client.models.list();
    const models: ModelInfo[] = [];
    for await (const model of response) {
      const id = model.id;
      const looksEmbedding = /embed|bge|minilm|e5-|gte-/i.test(id);
      models.push({
        id,
        label: id,
        capabilities: looksEmbedding ? ["embeddings"] : ["chat"],
        // Bare metadata: the UI lets the user re-assign capability.
        capabilityConfidence: "guessed",
      });
    }
    return models;
  }

  /** Embeddings via the standard `/v1/embeddings` route. */
  async embed(texts: string[], model: string): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model,
      input: texts,
    });
    return response.data.map((d) => d.embedding as number[]);
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const model = options.model;
    if (!model) {
      throw new Error(
        `${this.name}: a model must be selected for OpenAI-compatible endpoints (no default model map exists)`,
      );
    }
    if (options.enableSearchGrounding) {
      log.warn(
        "OpenAICompatible",
        `${this.name} has no search grounding; continuing without it`,
      );
    }
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;

    return withRetry(
      async (attempt) => {
        const startMs = Date.now();
        const result = await withTimeout(
          (signal) => this.runChat(options, model, signal, startMs),
          timeoutMs,
          options.signal,
        );
        if (options.responseFormat === "json") {
          parseAIJson(result.text, `${this.name}.generate(${model})`);
        }
        if (attempt > 1) {
          log.info(
            "OpenAICompatible",
            `${model} succeeded on attempt ${attempt}/${AI_DEFAULTS.maxAttempts}`,
          );
        }
        return result;
      },
      {
        signal: options.signal,
        onRetry: (attempt, err) =>
          log.warn(
            "OpenAICompatible",
            `${model} attempt ${attempt} failed (will retry): ${getErrorMessage(err).slice(0, 200)}`,
          ),
      },
    );
  }

  private async runChat(
    options: AIGenerateOptions,
    model: string,
    signal: AbortSignal,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const wantsJson = options.responseFormat === "json";
    let mode: JsonMode = wantsJson
      ? (this.jsonModes.get(model) ?? "json_schema")
      : "prompt";

    // Walk down the ladder until one mode yields parseable JSON. A backend can
    // fail loudly (a 400 naming response_format) or quietly (a 200 whose body
    // is not JSON at all), so both a rejection and an unparseable body trigger
    // the downgrade.
    for (;;) {
      let result: AIGenerateResult;
      try {
        result = await this.attempt(options, model, mode, signal, startMs);
      } catch (err) {
        const next = this.nextMode(mode);
        if (wantsJson && next && isFormatRejection(getErrorMessage(err))) {
          log.warn(
            "OpenAICompatible",
            `${model} rejected ${mode}; downgrading structured output to ${next}`,
          );
          this.jsonModes.set(model, next);
          mode = next;
          continue;
        }
        throw err;
      }

      if (!wantsJson) return result;
      if (isParseableJson(result.text)) {
        // Remember what worked so later calls skip the failed rungs.
        this.jsonModes.set(model, mode);
        return result;
      }

      const next = this.nextMode(mode);
      if (!next) return result; // Let the caller's parse surface the error.
      log.warn(
        "OpenAICompatible",
        `${model} returned unparseable JSON under ${mode}; downgrading to ${next}`,
      );
      this.jsonModes.set(model, next);
      mode = next;
    }
  }

  /** Next rung down the structured-output ladder, or null at the bottom. */
  private nextMode(mode: JsonMode): JsonMode | null {
    if (mode === "json_schema") return "json_object";
    if (mode === "json_object") return "prompt";
    return null;
  }

  private async attempt(
    options: AIGenerateOptions,
    model: string,
    mode: JsonMode,
    signal: AbortSignal,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    let systemPrompt = options.systemPrompt ?? "";
    // In prompt mode the schema itself becomes the instruction.
    if (options.responseFormat === "json" && mode === "prompt") {
      const schemaText = options.jsonSchema
        ? `\n\nRespond with JSON matching this schema:\n${JSON.stringify(
            translateSchemaNode(options.jsonSchema),
          )}`
        : "";
      systemPrompt += `\n\nRespond with valid JSON only — no markdown fences, no prose.${schemaText}`;
    }
    if (systemPrompt.trim()) {
      messages.push({ role: "system", content: systemPrompt.trim() });
    }
    messages.push({ role: "user", content: options.prompt });

    const requestParams: Record<string, unknown> = { model, messages };
    if (options.responseFormat === "json") {
      if (mode === "json_schema" && options.jsonSchema) {
        requestParams.response_format = {
          type: "json_schema",
          json_schema: {
            name: "response",
            strict: true,
            schema: translateSchemaNode(options.jsonSchema),
          },
        };
      } else if (mode === "json_object" || mode === "json_schema") {
        requestParams.response_format = { type: "json_object" };
      }
    }

    interface ChatCompletionResponse {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          /** Reasoning models (gemma-4, qwq, deepseek-r1…) split their output. */
          reasoning_content?: string | null;
        };
      }>;
      usage?: { total_tokens?: number };
    }
    const response = (await this.client.chat.completions.create(
      requestParams as unknown as Parameters<
        typeof this.client.chat.completions.create
      >[0],
      { signal },
    )) as unknown as ChatCompletionResponse;

    const choice = response.choices?.[0];
    const text = choice?.message?.content ?? "";
    // A reasoning model that hits the token ceiling mid-thought returns an
    // empty `content` with the budget spent in `reasoning_content`. Silently
    // returning "" would surface downstream as "malformed JSON", which sends
    // the user looking in the wrong place.
    if (!text.trim() && choice?.message?.reasoning_content?.trim()) {
      // 422, not 502: retrying replays the same prompt into the same ceiling,
      // which on a local model costs seconds per attempt for a certain failure.
      throw new AppError(
        `${this.name}: ${model} spent its entire token budget on reasoning and produced no answer` +
          (choice.finish_reason === "length"
            ? " (finish_reason=length — raise the server's token limit for this model)"
            : ""),
        422,
        { code: "AI_NO_ANSWER" },
      );
    }
    const tokenCount = response.usage?.total_tokens;
    const latencyMs = Date.now() - startMs;

    log.info(
      "OpenAICompatible",
      `${this.name} ${model} | ${latencyMs}ms | ${tokenCount ?? "?"} tokens`,
    );
    return { text, model, tokenCount, latencyMs };
  }
}
