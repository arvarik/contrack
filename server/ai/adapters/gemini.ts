// =============================================================================
// AI Layer — Concrete Gemini Adapter
// =============================================================================
// This is the ONLY file in the codebase that imports from `@google/genai`.
// All Gemini SDK coupling is contained here. The rest of the AI layer
// programs against the abstract AIProvider interface.
// =============================================================================

import { GoogleGenAI, Type } from "@google/genai";
import type { AIProvider } from "../provider.ts";
import type { AIGenerateOptions, AIGenerateResult, JsonSchemaNode } from "../types.ts";
import { log } from "../../utils/logger.ts";

// ---------------------------------------------------------------------------
// Model Fallback Chain
// ---------------------------------------------------------------------------
// Ordered by cost-efficiency and rate-limit headroom. The adapter tries each
// model in sequence until one succeeds, providing resilience against
// per-model rate limits or transient failures.
//
// Model IDs verified against the Gemini API docs (April 2026).
// Only STABLE (non-Preview) models are listed here. Preview models require
// explicit allowlisting from Google and have unstable availability.
// ---------------------------------------------------------------------------

const FALLBACK_MODELS = [
  "gemini-2.5-flash-lite",  // Fastest & cheapest in the 2.5 family; highest RPM
  "gemini-2.5-flash",       // Best price-performance; low-latency, reasoning-capable
  "gemini-2.5-pro",         // Most capable; lower RPM, use as last resort
];

// ---------------------------------------------------------------------------
// JSON Schema Translation
// ---------------------------------------------------------------------------
// Converts a provider-agnostic JsonSchemaNode tree into Gemini's native
// schema format that uses the `Type.*` enum vocabulary.
// ---------------------------------------------------------------------------

function translateSchema(node: JsonSchemaNode): any {
  const typeMap: Record<string, any> = {
    object: Type.OBJECT,
    array: Type.ARRAY,
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
  };

  const result: any = {
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

/** Returns true if the error looks like a transient rate-limit or quota error. */
function isRetryableError(error: any): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("503") ||
    msg.includes("unavailable")
  );
}

/**
 * Builds the effective prompt by prepending a systemPrompt when provided.
 * Gemini's generateContent API (non-Chat mode) does not have a dedicated
 * system turn in the same request structure, so we prepend it clearly.
 */
function buildContents(options: AIGenerateOptions): string {
  if (!options.systemPrompt) return options.prompt;
  return `[SYSTEM]\n${options.systemPrompt}\n\n[USER]\n${options.prompt}`;
}

// ---------------------------------------------------------------------------
// Gemini Adapter
// ---------------------------------------------------------------------------

export class GeminiAdapter implements AIProvider {
  readonly name = "Gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const startMs = Date.now();
    let lastError: Error | null = null;

    for (const model of FALLBACK_MODELS) {
      try {
        const config: any = {};

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

        const response = await this.client.models.generateContent({
          model,
          contents: buildContents(options),
          config,
        });

        const text = response.text ?? "";
        const tokenCount = response.usageMetadata?.totalTokenCount;
        const latencyMs = Date.now() - startMs;

        log.debug("GeminiAdapter", `${model} → ${tokenCount ?? "?"} tokens in ${latencyMs}ms`);
        return { text, model, tokenCount, latencyMs };

      } catch (error: any) {
        lastError = error;
        if (isRetryableError(error)) {
          log.warn("GeminiAdapter", `Model ${model} rate-limited/unavailable: ${error.message}. Trying next fallback...`);
        } else {
          // Hard error (bad request, auth, etc.) — no point trying other models
          log.error("GeminiAdapter", `Model ${model} hard error: ${error.message}`);
          throw error;
        }
      }
    }

    log.error("GeminiAdapter", "All fallback models exhausted or rate limited.");
    throw lastError ?? new Error("All Gemini fallback models exhausted");
  }
}
