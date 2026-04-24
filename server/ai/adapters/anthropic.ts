// =============================================================================
// AI Layer — Concrete Anthropic Adapter
// =============================================================================
// This is the ONLY file in the codebase that imports from `@anthropic-ai/sdk`.
// All Anthropic SDK coupling is contained here. The rest of the AI layer
// programs against the abstract AIProvider interface.
//
// Key differences from Gemini and OpenAI:
// - System prompt is a separate `system` parameter (not a message role)
// - Requires explicit `max_tokens` on every request
// - Supports native `nullable` in JSON schema
// - Web search via native `web_search` tool
// - Supports grounding + structured output in a single request (single-pass)
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "../provider.ts";
import type { AIGenerateOptions, AIGenerateResult, JsonSchemaNode } from "../types.ts";
import { log } from "../../utils/logger.ts";

// ---------------------------------------------------------------------------
// Model Class Mapping
// ---------------------------------------------------------------------------
// Contract (ARCHITECTURE.md §2):
//   lite  → claude-haiku-4.5
//   flash → claude-sonnet-4.6
//   pro   → claude-opus-4.6
// ---------------------------------------------------------------------------

const MODEL_MAP: Record<string, string> = {
  lite: "claude-haiku-4.5",
  flash: "claude-sonnet-4.6",
  pro: "claude-opus-4.6",
};

const DEFAULT_MODEL_CLASS = "lite";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default max_tokens for standard requests (Anthropic requires this) */
const DEFAULT_MAX_TOKENS = 4096;

/** Increased max_tokens for search grounding (more text expected) */
const SEARCH_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Schema Translation
// ---------------------------------------------------------------------------
// Converts a provider-agnostic JsonSchemaNode tree into Anthropic's
// output_config.format: { type: "json_schema", json_schema: { ... } }
//
// Anthropic supports native `nullable`, so no anyOf transformation needed.
// ---------------------------------------------------------------------------

function translateSchemaNode(node: JsonSchemaNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  result.type = node.type;

  if (node.nullable) {
    result.nullable = true;
  }

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
// Anthropic Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements AIProvider {
  readonly name = "Anthropic";
  readonly defaultMaxTokens = DEFAULT_MAX_TOKENS;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Resolve a model class preference to a concrete Anthropic model ID.
   * If an explicit modelOverride is provided, it bypasses the class mapping.
   */
  resolveModel(prefer?: string, modelOverride?: string): string {
    if (modelOverride) return modelOverride;
    return MODEL_MAP[prefer ?? DEFAULT_MODEL_CLASS] ?? MODEL_MAP[DEFAULT_MODEL_CLASS];
  }

  /**
   * Translate a provider-agnostic JsonSchemaNode into Anthropic's
   * json_schema output format.
   */
  translateSchema(schema: JsonSchemaNode): {
    type: "json_schema";
    json_schema: { name: string; schema: Record<string, unknown> };
  } {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: translateSchemaNode(schema),
      },
    };
  }

  // ── AIProvider.generate() ───────────────────────────────────────────
  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const startMs = Date.now();
    const model = options.model ?? this.resolveModel(options.routing?.prefer);
    const maxTokens = options.enableSearchGrounding ? SEARCH_MAX_TOKENS : DEFAULT_MAX_TOKENS;

    const messages: Array<{ role: "user"; content: string }> = [
      { role: "user", content: options.prompt },
    ];

    const requestParams: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
    };

    // System prompt is a separate parameter in Anthropic (not a message)
    if (options.systemPrompt) {
      requestParams.system = options.systemPrompt;
    }

    // Web search grounding
    if (options.enableSearchGrounding) {
      requestParams.tools = [{ type: "web_search" }];
    }

    // Structured JSON output
    if (options.responseFormat === "json" && options.jsonSchema) {
      requestParams.output_config = {
        format: this.translateSchema(options.jsonSchema),
      };
    }

    const response: any = await this.client.messages.create(
      requestParams as unknown as Parameters<typeof this.client.messages.create>[0],
    );

    // Extract text from content blocks
    let text = "";
    if (response.content) {
      for (const block of response.content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
    }

    const tokenCount =
      (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    const latencyMs = Date.now() - startMs;

    log.info(
      "AnthropicAdapter",
      `${model} | ${latencyMs}ms | ${tokenCount} tokens`,
    );

    return { text, model, tokenCount, latencyMs };
  }
}
