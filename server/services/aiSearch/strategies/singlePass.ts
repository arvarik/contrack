import { AppError } from "../../../utils/AppError.ts";
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
// It holds the two-pass rule: no source links, no field changes. The
// adapters return the pages the answer read (OpenAI's web_search_call
// sources, Anthropic's web_search_tool_result blocks), and the merge engine
// lists them under the dossier's Sources.
//
// Used automatically when research resolves to OpenAI or Anthropic.
// =============================================================================

import { generateFor } from "../../../ai/gateway.ts";
import { toCitations } from "../../../ai/citations.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type { AISearchStrategy, AISearchResult } from "../types.ts";
import {
  extractionJsonSchema,
  parseExtraction,
  tidyExtraction,
} from "../promptTemplate.ts";
import { recordInvocation } from "../../../services/aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";

// =============================================================================
// Strategy Implementation
// =============================================================================

export class SinglePassStrategy implements AISearchStrategy {
  readonly name = "single-pass";

  async execute(
    contact: HydratedContact,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AISearchResult> {
    signal?.throwIfAborted();
    const startMs = Date.now();

    // Single combined request: web search + structured JSON output.
    const result = await generateFor("research", {
      // The research prompt asks for fact lines, for the two-pass strategy.
      // This one call has to answer in the schema instead.
      prompt: `${prompt}\n\nReturn what you find as JSON in the response schema, not as lines.`,
      responseFormat: "json",
      jsonSchema: extractionJsonSchema,
      enableSearchGrounding: true,
      signal,
      // One call does the searching and the writing, and the research prompt
      // leads to four or five searches: GPT-6 Sol took 35 to 48 s on it
      // (2026-09-26). The job around this call allows 240 s.
      timeoutMs: 85_000,
      maxOutputTokens: 4_000,
    });

    signal?.throwIfAborted();
    // Record invocation for AI Stats tracking
    recordInvocation({
      operation: "aiSearchSinglePass",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `AI Search single-pass: ${contact.name}`,
    });

    log.info(
      "SinglePassStrategy",
      `Complete via ${result.model} in ${result.latencyMs}ms` +
        ` (${result.tokenCount ?? "?"} tokens)`,
    );

    // An answer the model gave without reading anything is not research.
    const citations = toCitations(
      (result.citations ?? []).map((c) => ({ url: c.uri, title: c.title })),
    );
    if (citations.length === 0)
      throw new AppError(
        "Research did not include source links. No contact fields changed. Choose another research model in AI settings.",
        502,
        { code: "AI_GROUNDING_MISSING" },
      );

    // Parse and validate with Zod
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(result.text || "{}");
    } catch (parseErr: unknown) {
      throw new Error(
        `JSON parse failed for single-pass output: ${getErrorMessage(parseErr)}. ` +
          "",
      );
    }

    // Field by field: a value that fails its schema is left out.
    const { data: parsed, dropped } = parseExtraction(rawParsed);
    const structuredData = tidyExtraction(parsed, contact);
    if (dropped.length > 0)
      log.warn(
        "SinglePassStrategy",
        `${result.model} wrote values the schema refused; left out: ${dropped.join(", ")}`,
      );
    const latencyMs = Date.now() - startMs;

    return {
      data: structuredData as Record<string, unknown>,
      models: [result.model],
      tokenCount: result.tokenCount,
      latencyMs,
      citations,
      // Single-pass combines grounding + extraction, so grounded text = raw response
      groundedText: result.text.trim(),
    };
  }
}
