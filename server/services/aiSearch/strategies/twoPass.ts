// =============================================================================
// AI Search — Two-Pass Strategy (V2)
// =============================================================================
// The canonical strategy for AI Search. Uses two sequential LLM calls to
// work around the Gemini API constraint: googleSearch grounding and
// responseSchema cannot coexist in the same request.
//
// Pass 1 — Grounding: Uses Google Search tool for live internet research.
//          Returns free-form text with grounding citations.
//          Prefers "pro" models for highest search accuracy.
// Pass 2 — Extraction: Takes the grounded text and extracts structured
//          JSON using a responseSchema. No grounding (already done).
//          Prefers "lite" models — cheap pure-formatting task.
//
// V2: Model selection is now handled by the SmartRouter via `routing.prefer`
// instead of hardcoded fallback arrays. The router handles capacity checks,
// circuit breakers, and tier-aware model selection automatically.
// =============================================================================

import type { AIProvider } from "../../../ai/provider.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type { AISearchStrategy, AISearchResult } from "../types.ts";
import { aiSearchOutputSchema, extractionJsonSchema } from "../promptTemplate.ts";
import { log } from "../../../utils/logger.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max attempts for Pass 1 when the search tool returns empty text */
const GROUNDING_MAX_RETRIES = 2;

/** Delay before retrying a grounding call that returned empty text */
const GROUNDING_RETRY_DELAY_MS = 1_500;

// =============================================================================
// Strategy Implementation
// =============================================================================

export class TwoPassStrategy implements AISearchStrategy {
  readonly name = 'two-pass';

  async execute(
    _contact: HydratedContact,
    prompt: string,
    adapter: AIProvider,
  ): Promise<AISearchResult> {
    const startMs = Date.now();
    const modelsUsed: string[] = [];
    let totalTokens = 0;
    let citations: Array<{ title: string; uri: string }> = [];

    // ── Pass 1: Grounding (web search → text output) ──────────────────
    // Prefer "pro" models for maximum search grounding accuracy.
    // The SmartRouter handles model fallback via circuit breakers —
    // no manual model array iteration needed.
    let groundedText = '';

    for (let attempt = 1; attempt <= GROUNDING_MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        log.info('TwoPassStrategy', `Pass 1 (grounding) — retry ${attempt} after empty result`);
        await new Promise(r => setTimeout(r, GROUNDING_RETRY_DELAY_MS));
      }

      try {
        const pass1Result = await adapter.generate({
          prompt,
          responseFormat: 'text',
          enableSearchGrounding: true,
          routing: { prefer: "pro" },
        });

        groundedText = pass1Result.text;
        modelsUsed.push(pass1Result.model);
        totalTokens += pass1Result.tokenCount ?? 0;

        log.info(
          'TwoPassStrategy',
          `Pass 1 complete via ${pass1Result.model} in ${pass1Result.latencyMs}ms` +
            ` (${pass1Result.tokenCount ?? '?'} tokens)`,
        );

        if (groundedText.trim()) {
          break; // Got non-empty text — success
        }

        log.warn('TwoPassStrategy', `Pass 1 returned empty text (attempt ${attempt})`);
      } catch (err: any) {
        log.warn('TwoPassStrategy', `Pass 1 failed: ${err.message}`);
        // On the last attempt, surface the error
        if (attempt === GROUNDING_MAX_RETRIES) {
          throw err;
        }
      }
    }

    if (!groundedText.trim()) {
      throw new Error(
        'No public information found for this contact. ' +
          'The AI searched the internet but could not identify or find data about this person.',
      );
    }

    // ── Pass 2: Extraction (grounded text → structured JSON) ──────────
    // Prefer "lite" models — this is a pure formatting/extraction task.
    const extractionPrompt = `
Below is research text about a specific professional contact.
Extract the information into the JSON schema provided.
Only extract fields explicitly mentioned in the text.
Return null for any field not clearly stated.
Do NOT invent or infer information not present in the research text.

Research text:
---
${groundedText}
---
    `.trim();

    const pass2Result = await adapter.generate({
      prompt: extractionPrompt,
      responseFormat: 'json',
      jsonSchema: extractionJsonSchema,
      routing: { prefer: "lite" },
    });

    modelsUsed.push(pass2Result.model);
    totalTokens += pass2Result.tokenCount ?? 0;

    // Parse and validate with Zod (default .strip() mode — silently
    // drops unrecognized fields rather than rejecting the entire response)
    const rawParsed = JSON.parse(pass2Result.text || '{}');
    const validated = aiSearchOutputSchema.safeParse(rawParsed);

    if (!validated.success) {
      throw new Error(`Zod validation failed: ${validated.error.message}`);
    }

    const structuredData = validated.data as Record<string, unknown>;
    log.info(
      'TwoPassStrategy',
      `Pass 2 complete via ${pass2Result.model} in ${pass2Result.latencyMs}ms` +
        ` (${pass2Result.tokenCount ?? '?'} tokens)`,
    );

    const latencyMs = Date.now() - startMs;

    return {
      data: structuredData,
      models: modelsUsed,
      tokenCount: totalTokens,
      latencyMs,
      citations,
    };
  }
}
