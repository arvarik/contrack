// =============================================================================
// AI Layer — Concrete Anthropic Adapter
// =============================================================================
// This is the ONLY file in the codebase that imports from `@anthropic-ai/sdk`.
// All Anthropic SDK coupling is contained here.
//
// Resiliency (Phase 2 backend refactor) — see `ai/resilience.ts`:
//   - Per-attempt AbortSignal-backed timeout (default 60s).
//   - Exponential backoff with jitter on transient failures.
//   - Caller-cancellation via options.signal.
//   - Tolerant JSON validation for responseFormat === "json".
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "../provider.ts";
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

const MODEL_MAP: Record<string, string> = {
  lite: "claude-haiku-4.5",
  flash: "claude-sonnet-4.6",
  pro: "claude-opus-4.6",
};

const DEFAULT_MODEL_CLASS = "lite";

const DEFAULT_MAX_TOKENS = 4096;
const SEARCH_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Schema Translation — Anthropic supports nullable natively
// ---------------------------------------------------------------------------

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  const result: Record<string, unknown> = { type: node.type };
  if (node.nullable) result.nullable = true;
  if (node.enum) result.enum = node.enum;
  if (node.description) result.description = node.description;

  if (node.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      (result.properties as Record<string, unknown>)[key] =
        translateSchemaNode(value);
    }
  }
  if (node.items) result.items = translateSchemaNode(node.items);
  if (node.required) result.required = node.required;
  return result;
}

// ---------------------------------------------------------------------------
// Anthropic Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements AIProvider {
  readonly name = "Anthropic";
  readonly defaultMaxTokens = DEFAULT_MAX_TOKENS;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  resolveModel(prefer?: string, modelOverride?: string): string {
    if (modelOverride) return modelOverride;
    return (
      MODEL_MAP[prefer ?? DEFAULT_MODEL_CLASS] ?? MODEL_MAP[DEFAULT_MODEL_CLASS]
    );
  }

  translateSchema(schema: JsonSchemaNode): {
    type: "json_schema";
    json_schema: { name: string; schema: Record<string, unknown> };
  } {
    return {
      type: "json_schema",
      json_schema: { name: "response", schema: translateSchemaNode(schema) },
    };
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const model = options.model ?? this.resolveModel(options.routing?.prefer);
    const timeoutMs = options.timeoutMs ?? AI_DEFAULTS.perAttemptTimeoutMs;
    const maxTokens = options.enableSearchGrounding
      ? SEARCH_MAX_TOKENS
      : DEFAULT_MAX_TOKENS;

    return withRetry(
      async (attempt) => {
        const startMs = Date.now();
        const result = await withTimeout(
          (signal) =>
            this.runMessages(options, model, maxTokens, signal, startMs),
          timeoutMs,
          options.signal,
        );

        if (options.responseFormat === "json") {
          parseAIJson(result.text, `AnthropicAdapter.generate(${model})`);
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

  private async runMessages(
    options: AIGenerateOptions,
    model: string,
    maxTokens: number,
    signal: AbortSignal,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const messages: Array<{ role: "user"; content: string }> = [
      { role: "user", content: options.prompt },
    ];

    const requestParams: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
    };
    if (options.systemPrompt) requestParams.system = options.systemPrompt;
    if (options.enableSearchGrounding)
      requestParams.tools = [{ type: "web_search" }];
    if (options.responseFormat === "json" && options.jsonSchema) {
      requestParams.output_config = {
        format: this.translateSchema(options.jsonSchema),
      };
    }

    // Local response shape — the SDK's `Message` union (text / tool_use /
    // server_tool_use / web_search_tool_result) is too granular for our needs.
    interface ClaudeMessageResponse {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }
    const response = (await this.client.messages.create(
      requestParams as unknown as Parameters<
        typeof this.client.messages.create
      >[0],
      { signal },
    )) as unknown as ClaudeMessageResponse;

    let text = "";
    if (response.content) {
      for (const block of response.content) {
        if (block.type === "text" && typeof block.text === "string") {
          text += block.text;
        }
      }
    }

    const tokenCount =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0);
    const latencyMs = Date.now() - startMs;

    log.info(
      "AnthropicAdapter",
      `${model} | ${latencyMs}ms | ${tokenCount} tokens`,
    );
    return { text, model, tokenCount, latencyMs };
  }
}
