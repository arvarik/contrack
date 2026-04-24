// =============================================================================
// AI Search — Single-Pass Strategy
// =============================================================================
// For non-Gemini providers (OpenAI, Anthropic), web search + structured
// output can coexist in a single request — eliminating the need for the
// two-pass workaround required by the Gemini API.
//
// This strategy sends a single adapter.generate() call with both
// enableSearchGrounding: true and responseFormat: "json" + jsonSchema,
// letting the provider handle grounding and extraction atomically.
//
// Used automatically when AI_PROVIDER is "openai" or "anthropic".
// =============================================================================

import type { AIProvider } from "../../../ai/provider.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type { AISearchStrategy, AISearchResult } from "../types.ts";
import { aiSearchOutputSchema, extractionJsonSchema } from "../promptTemplate.ts";
import { recordInvocation } from "../../../services/aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";

// =============================================================================
// Strategy Implementation
// =============================================================================

export class SinglePassStrategy implements AISearchStrategy {
  readonly name = "single-pass";

  async execute(
    _contact: HydratedContact,
    prompt: string,
    adapter: AIProvider,
  ): Promise<AISearchResult> {
    const startMs = Date.now();

    // Single combined request: web search + structured JSON output
    // Prefer "pro" model class for maximum quality on research tasks.
    const result = await adapter.generate({
      prompt,
      responseFormat: "json",
      jsonSchema: extractionJsonSchema,
      enableSearchGrounding: true,
      routing: { prefer: "pro" },
    });

    // Record invocation for AI Stats tracking
    recordInvocation({
      operation: "aiSearchSinglePass",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `AI Search single-pass: ${_contact.name}`,
    });

    log.info(
      "SinglePassStrategy",
      `Complete via ${result.model} in ${result.latencyMs}ms` +
        ` (${result.tokenCount ?? "?"} tokens)`,
    );

    // Parse and validate with Zod
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(result.text || "{}");
    } catch (parseErr: unknown) {
      throw new Error(
        `JSON parse failed for single-pass output: ${getErrorMessage(parseErr)}. ` +
          `Raw text: ${(result.text || "").slice(0, 200)}`,
      );
    }

    const validated = aiSearchOutputSchema.safeParse(rawParsed);
    if (!validated.success) {
      throw new Error(`Zod validation failed: ${validated.error.message}`);
    }

    const structuredData = validated.data as Record<string, unknown>;
    const latencyMs = Date.now() - startMs;

    return {
      data: structuredData,
      models: [result.model],
      tokenCount: result.tokenCount,
      latencyMs,
      // Single-pass combines grounding + extraction, so grounded text = raw response
      groundedText: result.text.trim(),
    };
  }
}
