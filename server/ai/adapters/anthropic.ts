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
import type { AIProvider, ModelInfo } from "../provider.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
} from "../types.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
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
  lite: "claude-haiku-4-5",
  flash: "claude-sonnet-4-6",
  pro: "claude-opus-4-6",
};

const DEFAULT_MODEL_CLASS = "lite";

const DEFAULT_MAX_TOKENS = 4096;
const SEARCH_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Schema Translation — Anthropic supports nullable natively
// ---------------------------------------------------------------------------

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  // JSON Schema expresses nullability as a type union, not OpenAPI's `nullable`.
  const result: Record<string, unknown> = {
    type: node.nullable ? [node.type, "null"] : node.type,
  };
  if (node.enum) result.enum = node.enum;
  if (node.description) result.description = node.description;

  if (node.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      (result.properties as Record<string, unknown>)[key] =
        translateSchemaNode(value);
    }
  }
  if (node.type === "object") result.additionalProperties = false;
  if (node.items) result.items = translateSchemaNode(node.items);
  if (node.required) result.required = node.required;
  return result;
}

/**
 * True when Claude refused the schema itself rather than the request. These
 * are deterministic — retrying the same schema always fails — so the caller
 * must change approach instead of backing off.
 */
function isSchemaComplexityError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("too many optional parameters") ||
    msg.includes("grammar compilation") ||
    (msg.includes("output_config.format") && msg.includes("schema"))
  );
}

// ---------------------------------------------------------------------------
// Anthropic Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements AIProvider {
  readonly name = "Anthropic";
  readonly supportsSearchGrounding = true;
  readonly defaultMaxTokens = DEFAULT_MAX_TOKENS;
  private client: Anthropic;
  /**
   * Prompts whose schema Claude declined to compile (it caps optional
   * parameters at 24). Remembered so the retry is paid once, not per call.
   */
  private schemaTooComplex = new Set<string>();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Enumerate models. Anthropic reports ids + display names; every listed
   * model is a chat model (Anthropic ships no first-party embedding models).
   */
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const model of this.client.models.list()) {
      models.push({
        id: model.id,
        label: model.display_name ?? model.id,
        capabilities: ["chat"],
        capabilityConfidence: "declared",
      });
    }
    return models;
  }

  resolveModel(prefer?: string, modelOverride?: string): string {
    if (modelOverride) return modelOverride;
    return (
      MODEL_MAP[prefer ?? DEFAULT_MODEL_CLASS] ?? MODEL_MAP[DEFAULT_MODEL_CLASS]
    );
  }

  /**
   * Anthropic's `output_config.format` takes the schema directly:
   *   { type: "json_schema", schema: {...} }
   * NOT OpenAI's nested `json_schema: { name, schema }` wrapper, which the
   * API rejects with a 400.
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
      ? SEARCH_MAX_TOKENS
      : DEFAULT_MAX_TOKENS;

    return withRetry(
      async (attempt) => {
        const startMs = Date.now();
        const schemaKey = `${model}:${options.systemPrompt?.slice(0, 60) ?? ""}`;
        let useSchema = !this.schemaTooComplex.has(schemaKey);
        let result: AIGenerateResult;
        try {
          result = await withTimeout(
            (signal) =>
              this.runMessages(
                options,
                model,
                maxTokens,
                signal,
                startMs,
                useSchema,
              ),
            timeoutMs,
            options.signal,
          );
        } catch (err) {
          // Claude caps a schema at 24 optional parameters. Contrack's research
          // schema is legitimately wider than that, so drop to prompt-guided
          // JSON rather than failing the whole enrichment.
          if (!useSchema || !isSchemaComplexityError(err)) throw err;
          log.warn(
            "AnthropicAdapter",
            `${model} declined the response schema (${getErrorMessage(err).slice(0, 120)}); retrying with prompt-guided JSON`,
          );
          this.schemaTooComplex.add(schemaKey);
          useSchema = false;
          result = await withTimeout(
            (signal) =>
              this.runMessages(
                options,
                model,
                maxTokens,
                signal,
                startMs,
                false,
              ),
            timeoutMs,
            options.signal,
          );
        }

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
    useSchema = true,
  ): Promise<AIGenerateResult> {
    const messages: Array<{ role: "user"; content: string }> = [
      { role: "user", content: options.prompt },
    ];

    const requestParams: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
    };
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
    if (systemPrompt.trim()) requestParams.system = systemPrompt.trim();
    if (options.enableSearchGrounding) {
      // Sonnet/Opus 4.6+ support the dynamic-filtering variant; Haiku 4.5
      // only supports the basic one.
      const webSearchType = model.includes("haiku")
        ? "web_search_20250305"
        : "web_search_20260209";
      requestParams.tools = [{ type: webSearchType, name: "web_search" }];
    }
    if (options.responseFormat === "json" && options.jsonSchema && useSchema) {
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
