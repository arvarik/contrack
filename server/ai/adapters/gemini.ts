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
// ---------------------------------------------------------------------------

const FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",   // cheapest, highest RPM (4K RPM / 4M TPM)
  "gemini-2.5-flash-lite",   // older lite fallback with unlimited RPD
  "gemini-3-flash",          // highly capable standard model (1K RPM)
  "gemini-2-flash",          // legacy unlimited RPD fallback
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

  if (node.nullable) {
    result.nullable = true;
  }

  if (node.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      result.properties[key] = translateSchema(value);
    }
  }

  if (node.items) {
    result.items = translateSchema(node.items);
  }

  if (node.required) {
    result.required = node.required;
  }

  return result;
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

        if (options.responseFormat === "json") {
          config.responseMimeType = "application/json";
          if (options.jsonSchema) {
            config.responseSchema = translateSchema(options.jsonSchema);
          }
        } else {
          config.responseMimeType = "text/plain";
        }

        const response = await this.client.models.generateContent({
          model,
          contents: options.prompt,
          config,
        });

        const text = response.text ?? "";
        const tokenCount = response.usageMetadata?.totalTokenCount;
        const latencyMs = Date.now() - startMs;

        return { text, model, tokenCount, latencyMs };
      } catch (error: any) {
        log.warn("GeminiAdapter", `Model ${model} failed: ${error.message}. Trying next fallback...`);
        lastError = error;
      }
    }

    log.error("GeminiAdapter", "All fallback models exhausted or rate limited.");
    throw lastError ?? new Error("All Gemini fallback models exhausted");
  }
}
