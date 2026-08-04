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
// - Tolerant JSON validation when responseFormat === "json".
// - Caller-cancellation: if the request's AbortSignal aborts, no further
//   retries are attempted and an AppError(code: CANCELLED) is thrown.
// =============================================================================

import OpenAI from "openai";
import type { AIProvider, ModelInfo } from "../provider.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
} from "../types.ts";
import { log } from "../../utils/logger.ts";
import {
  withTimeout,
  withRetry,
  parseAIJson,
  AI_DEFAULTS,
} from "../resilience.ts";

// ---------------------------------------------------------------------------
// Model Class Mapping
// ---------------------------------------------------------------------------

// OpenAI introduced a "nano" size tier below mini with GPT-5.4 nano on
// 2026-03-17 ($0.20/1M input). That's now the closest equivalent to our
// internal "lite" class — cheapest + fastest, intended for classification /
// extraction / ranking style workloads. "flash" stays on 5.4-mini.
const MODEL_MAP: Record<string, string> = {
  lite: "gpt-5.4-nano",
  flash: "gpt-5.4-mini",
  pro: "gpt-5.4",
};

const DEFAULT_MODEL_CLASS = "lite";

// ---------------------------------------------------------------------------
// Schema Translation (unchanged — OpenAI still needs nullable→anyOf)
// ---------------------------------------------------------------------------

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (node.nullable) {
    return { anyOf: [{ type: node.type }, { type: "null" }] };
  }

  result.type = node.type;
  if (node.enum) result.enum = node.enum;
  if (node.description) result.description = node.description;

  if (node.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      (result.properties as Record<string, unknown>)[key] =
        translateSchemaNode(value);
    }
    result.additionalProperties = false;
  }

  if (node.items) result.items = translateSchemaNode(node.items);
  if (node.required) result.required = node.required;

  return result;
}

// ---------------------------------------------------------------------------
// OpenAI Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements AIProvider {
  readonly name = "OpenAI";
  readonly supportsSearchGrounding = true;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Enumerate models. OpenAI's list endpoint returns bare ids with no
   * capability metadata, so capability is pattern-matched and the settings UI
   * exposes an override.
   */
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const model of this.client.models.list()) {
      const id = model.id;
      if (/^(text-)?embedding|embedding-/i.test(id)) {
        models.push({
          id,
          label: id,
          capabilities: ["embeddings"],
          capabilityConfidence: "guessed",
        });
        continue;
      }
      // Exclude non-chat modalities (audio/image/moderation/realtime).
      if (
        /whisper|tts|dall-e|sora|moderation|transcribe|realtime|image/i.test(id)
      )
        continue;
      if (/^(gpt|o\d|chatgpt)/i.test(id)) {
        models.push({
          id,
          label: id,
          capabilities: ["chat"],
          capabilityConfidence: "guessed",
        });
      }
    }
    return models;
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
    return (
      MODEL_MAP[prefer ?? DEFAULT_MODEL_CLASS] ?? MODEL_MAP[DEFAULT_MODEL_CLASS]
    );
  }

  translateSchema(schema: JsonSchemaNode): {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  } {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        strict: true,
        schema: translateSchemaNode(schema),
      },
    };
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const model = options.model ?? this.resolveModel(options.routing?.prefer);
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;

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
        // caller can rely on `result.text` being parseable when requested.
        if (options.responseFormat === "json") {
          parseAIJson(result.text, `OpenAIAdapter.generate(${model})`);
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

    const requestParams: Record<string, unknown> = { model, messages };
    if (options.responseFormat === "json" && options.jsonSchema) {
      requestParams.response_format = this.translateSchema(options.jsonSchema);
    } else if (options.responseFormat === "json") {
      requestParams.response_format = { type: "json_object" };
    }

    // Minimal local response shape — the OpenAI SDK types are unions over a dozen
    // overloads (streaming vs. non-streaming, function-calling, etc.) and TypeScript
    // can't narrow them at our call site. We assert the non-streaming branch here.
    interface ChatCompletionResponse {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { total_tokens?: number };
    }
    const response = (await this.client.chat.completions.create(
      requestParams as unknown as Parameters<
        typeof this.client.chat.completions.create
      >[0],
      { signal },
    )) as unknown as ChatCompletionResponse;

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

    const requestParams: Record<string, unknown> = {
      model,
      input,
      tools: [{ type: "web_search" }],
    };
    if (options.responseFormat === "json" && options.jsonSchema) {
      requestParams.text = { format: this.translateSchema(options.jsonSchema) };
    }

    // Local response shape for the Responses API — the SDK types are too
    // permissive (output can be any of a dozen tool/message types). We model
    // only the branches we extract from.
    interface ResponsesAPIResponse {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: { total_tokens?: number };
    }
    const response = (await this.client.responses.create(
      requestParams as unknown as Parameters<
        typeof this.client.responses.create
      >[0],
      { signal },
    )) as unknown as ResponsesAPIResponse;

    let text = "";
    if (response.output) {
      for (const item of response.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (
              block.type === "output_text" &&
              typeof block.text === "string"
            ) {
              text += block.text;
            }
          }
        }
      }
    }

    const tokenCount = response.usage?.total_tokens;
    const latencyMs = Date.now() - startMs;

    log.info(
      "OpenAIAdapter",
      `${model} (search) | ${latencyMs}ms | ${tokenCount ?? "?"} tokens`,
    );
    return { text, model, tokenCount, latencyMs };
  }
}
