// =============================================================================
// AI Search — Two-Pass Strategy (V1)
// =============================================================================
// The canonical strategy for AI Search. Uses two sequential LLM calls to
// work around the Gemini 2.5 API constraint: googleSearch grounding and
// responseSchema cannot coexist in the same request.
//
// Pass 1 — Grounding: Uses Google Search tool for live internet research.
//          Returns free-form text with grounding citations.
// Pass 2 — Extraction: Takes the grounded text and extracts structured
//          JSON using a responseSchema. No grounding (already done).
//
// Future: When Gemini 3.x GA models support grounding + schema in a single
// call, a SinglePassStrategy can be added to the registry to cut latency
// ~40% and halve token cost. See strategies/index.ts for registration.
// =============================================================================

import type { AIProvider } from "../../../ai/provider.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type { AISearchStrategy, AISearchResult } from "../types.ts";
import { aiSearchOutputSchema, extractionJsonSchema } from "../promptTemplate.ts";
import { log } from "../../../utils/logger.ts";

// ---------------------------------------------------------------------------
// Model Lists (verified stable — April 2026)
// ---------------------------------------------------------------------------
// These are separate from the FALLBACK_MODELS chain in gemini.ts because
// each pass has different requirements (grounding support vs schema support).
// ---------------------------------------------------------------------------

/** Pass 1: Must support googleSearch tool — verified stable models only */
const GROUNDING_MODELS = [
  'gemini-2.5-flash',       // Verified grounding-capable; best price-performance
  'gemini-2.5-pro',         // Fallback: most capable, lower RPM
];

/** Pass 2: Any schema-capable model (cheaper models are fine here) */
const EXTRACTION_MODELS = [
  'gemini-2.5-flash-lite',  // Cheapest — pure formatting task
  'gemini-2.5-flash',       // Fallback
  'gemini-2.5-pro',         // Last resort
];

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
    let groundedText = '';
    let pass1Error: Error | null = null;

    for (const model of GROUNDING_MODELS) {
      // Each model gets 2 attempts — grounding occasionally returns empty
      // text even for valid queries (search tool didn't engage).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) {
            log.info('TwoPassStrategy', `Pass 1 (grounding) → ${model} — retry after empty result`);
            await new Promise(r => setTimeout(r, 1_500));
          } else {
            log.info('TwoPassStrategy', `Pass 1 (grounding) → ${model}`);
          }

          const pass1Result = await adapter.generate({
            prompt,
            responseFormat: 'text',
            enableSearchGrounding: true,
            model,
          });

          groundedText = pass1Result.text;
          modelsUsed.push(pass1Result.model);
          totalTokens += pass1Result.tokenCount ?? 0;

          log.info('TwoPassStrategy', `Pass 1 complete via ${pass1Result.model} in ${pass1Result.latencyMs}ms (${pass1Result.tokenCount ?? '?'} tokens)`);

          if (groundedText.trim()) {
            pass1Error = null;
            break; // Got non-empty text — success
          }
          // Empty text — retry this model
          log.warn('TwoPassStrategy', `Pass 1 returned empty text from ${model} (attempt ${attempt + 1})`);
        } catch (err: any) {
          pass1Error = err;
          log.warn('TwoPassStrategy', `Pass 1 failed on ${model}: ${err.message}`);
          break; // Hard error — try next model
        }
      }
      if (groundedText.trim()) break; // Success — no need to try next model
    }

    if (pass1Error || !groundedText.trim()) {
      throw pass1Error ?? new Error('No public information found for this contact. The AI searched the internet but could not identify or find data about this person.');
    }

    // ── Pass 2: Extraction (grounded text → structured JSON) ──────────
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

    let structuredData: Record<string, unknown> = {};
    let pass2Error: Error | null = null;

    for (const model of EXTRACTION_MODELS) {
      try {
        log.info('TwoPassStrategy', `Pass 2 (extraction) → ${model}`);
        const pass2Result = await adapter.generate({
          prompt: extractionPrompt,
          responseFormat: 'json',
          jsonSchema: extractionJsonSchema,
          model,
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

        structuredData = validated.data as Record<string, unknown>;
        log.info('TwoPassStrategy', `Pass 2 complete via ${pass2Result.model} in ${pass2Result.latencyMs}ms (${pass2Result.tokenCount ?? '?'} tokens)`);
        pass2Error = null;
        break; // Success
      } catch (err: any) {
        pass2Error = err;
        log.warn('TwoPassStrategy', `Pass 2 failed on ${model}: ${err.message}`);
      }
    }

    if (pass2Error) {
      throw pass2Error;
    }

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
