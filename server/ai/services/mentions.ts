// =============================================================================
// AI Services — Mention Extraction (ghost contacts from timeline notes)
// =============================================================================
// Extracted verbatim from aiService.ts in the domain split; the barrel there
// re-exports this module, so import sites are unchanged.
// =============================================================================

import type { MentionEntity } from "../types.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { recordInvocation } from "../../services/aiStatsService.ts";
import { aiCache, contentHash } from "../../utils/aiCache.ts";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "../promptSafety.ts";
import { generateFor } from "../gateway.ts";
import { isMockMode, safeParseJson } from "./shared.ts";

/**
 * Examines a timeline note and extracts distinct person entities along
 * with contextual mapping. Avoids the document author.
 */
export async function extractMentions(text: string): Promise<MentionEntity[]> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock AI Mentions due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return [];
  }

  // ── Cache check: interaction text is immutable after save, so mention
  // extraction results are deterministic per input. Cache permanently (24h TTL).
  const cacheKey = contentHash(text);
  const cached = aiCache.get<MentionEntity[]>("mentions", cacheKey);
  if (cached) {
    recordInvocation({
      operation: "mentions",
      latencyMs: 0,
      cached: true,
      description: `Mentions: ${text.slice(0, 40)}`,
    });
    return cached;
  }

  const systemPrompt = `${UNTRUSTED_DATA_RULE}

You are a named-entity recognition system specializing in identifying people mentioned in CRM notes.
    Extract only distinct human beings — never the note author themselves.`;

  const prompt = `
    Analyze the following timeline note. Identify any human person introduced or mentioned in the text who is distinct from the primary user writing the note.
    
    If you find any names:
    - Extract their name.
    - Extract any company/organization associated dynamically with them (if mentioned).
    - Provide a short 3-5 word context of how they were mentioned.
    
    Return exactly a JSON array of objects.
    Schema: [{ "name": "string", "company": "string | null", "context": "string" }]
    If nobody new is mentioned, return an empty array [].
    
    ${wrapUntrusted("timeline note", text)}
  `;

  try {
    const result = await generateFor("quick", {
      systemPrompt,
      prompt,
      responseFormat: "json",
      jsonSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            company: { type: "string", nullable: true },
            context: { type: "string" },
          },
          required: ["name", "context"],
        },
      },
    });

    const parsed = safeParseJson<MentionEntity[]>(
      result.text,
      "extractMentions",
    );
    if (!parsed) return [];

    // Cache the result — immutable input means this is safe to cache long-term
    aiCache.set("mentions", cacheKey, parsed);

    log.info(
      "AIService",
      `extractMentions → ${parsed.length} ghost entities in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`,
    );
    recordInvocation({
      operation: "mentions",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `Mentions: ${text.slice(0, 40)}`,
    });
    return parsed;
  } catch (error: unknown) {
    log.error("AIService", "Mention extraction failed", {
      error: getErrorMessage(error),
    });
    return [];
  }
}
