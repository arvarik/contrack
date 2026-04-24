// =============================================================================
// AI Layer — Concrete OpenAI Adapter
// =============================================================================
// This is the ONLY file in the codebase that imports from `openai`.
// All OpenAI SDK coupling is contained here. The rest of the AI layer
// programs against the abstract AIProvider interface.
//
// Key differences from Gemini:
// - System prompt is a separate message role, not a config field
// - Structured output uses response_format: { type: "json_schema", ... }
// - Web search uses the Responses API with web_search tool
// - Supports grounding + structured output in a single request (single-pass)
// - Requires nullable → anyOf transformation (no native nullable support)
// =============================================================================

import OpenAI from "openai";
import type { AIProvider } from "../provider.ts";
import type { AIGenerateOptions, AIGenerateResult, JsonSchemaNode } from "../types.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

// ---------------------------------------------------------------------------
// Model Class Mapping
// ---------------------------------------------------------------------------
// Contract (ARCHITECTURE.md §2):
//   lite  → gpt-4o-mini
//   flash → gpt-5.4-mini
//   pro   → gpt-5.4
// ---------------------------------------------------------------------------

const MODEL_MAP: Record<string, string> = {
  lite: "gpt-4o-mini",
  flash: "gpt-5.4-mini",
  pro: "gpt-5.4",
};

const DEFAULT_MODEL_CLASS = "lite";

// ---------------------------------------------------------------------------
// Schema Translation
// ---------------------------------------------------------------------------
// Converts a provider-agnostic JsonSchemaNode tree into OpenAI's
// response_format: { type: "json_schema", json_schema: { ... } } format.
//
// Key transformation: OpenAI doesn't support `nullable` — must convert to
// anyOf: [{ type: "original" }, { type: "null" }]
// ---------------------------------------------------------------------------

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Handle nullable via anyOf pattern (OpenAI doesn't support nullable)
  if (node.nullable) {
    return {
      anyOf: [{ type: node.type }, { type: "null" }],
    };
  }

  result.type = node.type;

  if (node.enum) {
    result.enum = node.enum;
  }

  if (node.description) {
    result.description = node.description;
  }

  if (node.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      (result.properties as Record<string, unknown>)[key] = translateSchemaNode(value);
    }
    // OpenAI strict mode requires additionalProperties: false on objects
    result.additionalProperties = false;
  }

  if (node.items) {
    result.items = translateSchemaNode(node.items);
  }

  if (node.required) {
    result.required = node.required;
  }

  return result;
}

// ---------------------------------------------------------------------------
// OpenAI Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements AIProvider {
  readonly name = "OpenAI";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Resolve a model class preference to a concrete OpenAI model ID.
   * If an explicit modelOverride is provided, it bypasses the class mapping.
   */
  resolveModel(prefer?: string, modelOverride?: string): string {
    if (modelOverride) return modelOverride;
    return MODEL_MAP[prefer ?? DEFAULT_MODEL_CLASS] ?? MODEL_MAP[DEFAULT_MODEL_CLASS];
  }

  /**
   * Translate a provider-agnostic JsonSchemaNode into OpenAI's
   * response_format structure.
   */
  translateSchema(schema: JsonSchemaNode): {
    type: "json_schema";
    json_schema: { name: string; strict: true; schema: Record<string, unknown> };
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

  // ── AIProvider.generate() ───────────────────────────────────────────
  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const startMs = Date.now();
    const model = options.model ?? this.resolveModel(options.routing?.prefer);

    // ── Web search via Responses API ──────────────────────────────────
    if (options.enableSearchGrounding) {
      return this.generateWithSearch(options, model, startMs);
    }

    // ── Standard Chat Completion ──────────────────────────────────────
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.prompt });

    const requestParams: Record<string, unknown> = {
      model,
      messages,
    };

    // Structured JSON output
    if (options.responseFormat === "json" && options.jsonSchema) {
      requestParams.response_format = this.translateSchema(options.jsonSchema);
    } else if (options.responseFormat === "json") {
      requestParams.response_format = { type: "json_object" };
    }

    const response: any = await this.client.chat.completions.create(
      requestParams as unknown as Parameters<typeof this.client.chat.completions.create>[0],
    );

    const text = response.choices?.[0]?.message?.content ?? "";
    const tokenCount = response.usage?.total_tokens;
    const latencyMs = Date.now() - startMs;

    log.info(
      "OpenAIAdapter",
      `${model} | ${latencyMs}ms | ${tokenCount ?? "?"} tokens`,
    );

    return { text, model, tokenCount, latencyMs };
  }

  // ── Search Grounding via Responses API ──────────────────────────────
  // OpenAI's Responses API supports web_search as a tool, and can combine
  // it with structured output in a single request (unlike Gemini).
  private async generateWithSearch(
    options: AIGenerateOptions,
    model: string,
    startMs: number,
  ): Promise<AIGenerateResult> {
    const input: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      input.push({ role: "system", content: options.systemPrompt });
    }
    input.push({ role: "user", content: options.prompt });

    const requestParams: Record<string, unknown> = {
      model,
      input,
      tools: [{ type: "web_search" }],
    };

    // Can combine search + structured output in single pass
    if (options.responseFormat === "json" && options.jsonSchema) {
      requestParams.text = {
        format: this.translateSchema(options.jsonSchema),
      };
    }

    const response: any = await this.client.responses.create(
      requestParams as unknown as Parameters<typeof this.client.responses.create>[0],
    );

    // Extract text from the response output items
    let text = "";
    if (response.output) {
      for (const item of response.output as Array<Record<string, unknown>>) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const block of item.content as Array<Record<string, unknown>>) {
            if (block.type === "output_text" && typeof block.text === "string") {
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
