// =============================================================================
// AI Service — Provider-Agnostic Business Logic Facade
// =============================================================================
// This module contains all AI-powered business operations for the CRM.
// It programs against the abstract AIProvider interface, never directly
// against any LLM SDK. The concrete provider is the shared singleton
// from singleton.ts — ensuring one QuotaTracker, one SmartRouter, and
// one set of circuit breakers across the entire application.
//
// Public API surface:
//   - parseContactRecord(text)
//   - generateCatchMeUpBriefing(contact, interactions)
//   - extractMentions(text)
//   - summarizeEmlEmail(rawEml)
//   - semanticContactSearch(query, contacts)
//   - generateDailyInsight(stats)
//   - bulkParseContacts(texts, concurrency?)
// =============================================================================

import "dotenv/config";
import type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
} from "./types.ts";
import { sharedProvider, isProviderConfigured } from "./singleton.ts";
import { ParallelQueue } from "./routing/ParallelQueue.ts";
import { getAITier } from "./routing/registry.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { recordInvocation } from "../services/aiStatsService.ts";
import { aiCache, contentHash } from "../utils/aiCache.ts";

// Re-export domain types for consumers
export type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
};

// The shared provider instance — same one used by the barrel export in index.ts
const provider = sharedProvider;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the AI provider has no valid API key and will use mock responses. */
function isMockMode(): boolean {
  return !isProviderConfigured;
}

/**
 * Safely parses a JSON string from an LLM response.
 * LLMs occasionally return empty strings or malformed JSON despite schema enforcement.
 * This prevents an unhandled SyntaxError from crashing the caller.
 */
function safeParseJson<T>(text: string, context: string): T | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err: unknown) {
    log.error(
      "AIService",
      `[${context}] JSON.parse failed: ${getErrorMessage(err)}. Raw: ${text.slice(0, 200)}`,
    );
    return null;
  }
}

// =============================================================================
// 1. parseContactRecord
// =============================================================================

/**
 * Parses raw, unstructured text to extract contact fields accurately.
 * Returns a structured object compatible with the normalized schema —
 * emails, phones, socialLinks, education, experience are returned as
 * arrays that the server will insert into child tables.
 */
export async function parseContactRecord(text: string): Promise<ParsedContact> {
  if (isMockMode()) {
    throw new Error("AI provider not configured. Cannot run Auto-Parser.");
  }

  const systemPrompt = `You are an expert contact data extraction system.
    Your only job is to read unstructured text and extract contact fields with high precision.
    You NEVER invent or infer data not explicitly stated in the text.`;

  const prompt = `
    Extract contact information from the following unstructured text. 
    Map it to the structured schema reliably. If a field cannot be derived, omit it (leave it null/empty).
    For firstName and lastName, split from the full name if possible.
    For headline, extract a professional headline or tagline if present.
    For industry, extract the industry vertical if mentioned.
    For experience entries, try to determine if a role is current (isCurrent).
    For education entries, try to extract the field of study separately from degree.

    Text Payload:
    "${text}"
  `;

  const result = await provider.generate({
    systemPrompt,
    prompt,
    responseFormat: "json",
    routing: { prefer: "lite" },
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        headline: { type: "string" },
        company: { type: "string" },
        role: { type: "string" },
        location: { type: "string" },
        about: { type: "string" },
        pronouns: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              label: { type: "string" },
            },
          },
        },
        phones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              phone: { type: "string" },
              label: { type: "string" },
            },
          },
        },
        socialLinks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: { type: "string" },
              url: { type: "string" },
            },
          },
        },
        education: {
          type: "array",
          items: {
            type: "object",
            properties: {
              school: { type: "string" },
              degree: { type: "string" },
              fieldOfStudy: { type: "string" },
              startDate: { type: "string" },
              endDate: { type: "string" },
            },
          },
        },
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              role: { type: "string" },
              startDate: { type: "string" },
              endDate: { type: "string" },
              isCurrent: { type: "boolean" },
              description: { type: "string" },
              location: { type: "string" },
            },
          },
        },
      },
      required: ["name"],
    },
  });

  const parsed = safeParseJson<ParsedContact>(
    result.text,
    "parseContactRecord",
  );
  if (!parsed)
    throw new Error("AI returned malformed JSON for contact parsing");

  log.info(
    "AIService",
    `parseContactRecord → "${parsed.name}" via ${result.model} in ${result.latencyMs}ms | Tokens: ${result.tokenCount ?? "?"}`,
  );
  recordInvocation({
    operation: "parse",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: result.latencyMs,
    cached: false,
    description: `Parse: ${(parsed.name || text.slice(0, 30)).slice(0, 60)}`,
  });
  return parsed;
}

// =============================================================================
// 2. generateCatchMeUpBriefing
// =============================================================================

/**
 * Feeds a contact profile and their last N interactions into the AI to
 * generate an executive 3-bullet briefing. Enforces JSON array response.
 */
export async function generateCatchMeUpBriefing(
  contact: Record<string, unknown>,
  interactions: Record<string, unknown>[],
): Promise<string[]> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock AI Briefing due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return [
      "Met at the Design Systems Conference last year; he expressed strong interest in component-driven architecture.",
      "Need to close the loop on the draft proposal for the new Nexus design system integration.",
      "Icebreaker: Ask how his studio in Copenhagen is holding up with the recent sudden weather shift!",
    ];
  }

  const systemPrompt = `You are an elite executive assistant preparing a meeting brief.
    You synthesize contact profiles and interaction history into tightly-framed, highly actionable bullet points.
    Every point must be grounded in specific data — never pad with generalities.`;

  const prompt = `
    Read the following contact profile and their recent timeline of interactions.
    
    Synthesize exactly three (3) highly legible, concise bullet points:
    1. Key context from what was last discussed explicitly.
    2. Open loops / actionable items unresolved from previous talks.
    3. One personalized, highly relational conversational icebreaker based on their profile or past notes.

    Return the result as a simple JSON array of 3 strings. DO NOT use markdown lists inside the strings.
    If there isn't enough interaction history to derive meaningful points, gracefully mention that 
    this is a relatively new or sparse contact, but always return exactly 3 robust string bullet points.

    Contact Profile:
    ${JSON.stringify(contact, null, 2)}

    Recent Timeline (Past 15):
    ${JSON.stringify(interactions, null, 2)}
  `;

  const result = await provider.generate({
    systemPrompt,
    prompt,
    responseFormat: "json",
    routing: { prefer: "lite" },
    jsonSchema: {
      type: "array",
      items: { type: "string" },
    },
  });

  const parsed = safeParseJson<string[]>(
    result.text,
    "generateCatchMeUpBriefing",
  );
  if (!parsed || !Array.isArray(parsed)) {
    throw new Error("AI returned malformed response for briefing generation");
  }

  log.info(
    "AIService",
    `CatchMeUp briefing synthesized in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`,
  );
  recordInvocation({
    operation: "briefing",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: result.latencyMs,
    cached: false,
    description: `Catch-Me-Up for ${(contact as any).name || "contact"}`,
  });
  return parsed;
}

// =============================================================================
// 3. extractMentions
// =============================================================================

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

  const systemPrompt = `You are a named-entity recognition system specializing in identifying people mentioned in CRM notes.
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
    
    Timeline Note:
    "${text}"
  `;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "json",
      routing: { prefer: "lite" },
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

// =============================================================================
// 4. summarizeEmlEmail
// =============================================================================

/**
 * Parses raw .eml strings into highly actionable, formatted HTML thread summaries.
 * Designed to strip Apple Mail export jargon organically.
 */
export async function summarizeEmlEmail(rawEml: string): Promise<string> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock EML summary due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return "<p><strong>Re: Q3 Roadmap Planning</strong></p><p>Thread summary:</p><ul><li>Julian proposed pushing the V2 alpha back by two weeks.</li><li>Sarah agreed to coordinate with marketing.</li><li>John provided the final wireframe mocks for the reporting suite.</li></ul>";
  }

  const systemPrompt = `You are an expert executive assistant processing raw email exports.
    You distill email threads into clean, highly legible HTML summaries.
    You strip all MIME headers, legal footers, and security scanner additions.`;

  const prompt = `
    The user has exported an email thread and dropped it into the CRM.
    
    1. Parse the thread and identify the core subject, participants, and flow.
    2. Completely ignore and strip out all raw MIME boundaries, headers, legal disclaimers, signature blocks, and security scanning footers.
    3. Provide a highly legible, synthesized summary of the ACTUAL conversation thread. Do not just blindly copy the text. Distill it.
    4. Provide the final output as a clean HTML string. Use <ul>, <li>, <p>, and <strong> tags to make it ultra-readable inside a custom UI component pane. Do NOT wrap it in "html", "head", or "body" tags. Only return the inner content elements.
    
    Raw .EML text:
    "${rawEml}"
  `;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "text",
      routing: { prefer: "flash" },
    });

    log.info(
      "AIService",
      `EML digest synthesized in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`,
    );
    recordInvocation({
      operation: "emlSummary",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: "EML Summary",
    });
    return result.text || "<p>Email could not be parsed.</p>";
  } catch (error: unknown) {
    log.error("AIService", "EML summarization failed", {
      error: getErrorMessage(error),
    });
    return "<p><em>Error: Email string mapping structure breached context bounds.</em></p>";
  }
}

// =============================================================================
// 5. rerankCandidates (Ask Contrack v2)
// =============================================================================

/**
 * LLM-based reranker for Ask Contrack hybrid retrieval pipeline.
 *
 * Takes ~30 pre-filtered candidate contacts (from the hybrid retrieval
 * engine) and uses the LLM to determine which ones *definitively* match
 * the user's query, providing evidence-based reasons for each.
 *
 * This is the Stage 2 of the pipeline. Stage 1 (hybrid retrieval) narrows
 * ~960 contacts to ~30 candidates using FTS5 + vector KNN + SQL filters.
 * This function evaluates only those 30, making it:
 * - Much faster: ~1.5K input tokens vs ~100K+ in the old brute-force approach
 * - Much more accurate: the LLM judges pre-screened candidates, not haystacks
 * - Much cheaper: uses "lite" model class for a pure filtering task
 */
export async function rerankCandidates(
  query: string,
  candidates: CompressedContact[],
): Promise<SemanticMatchResult[]> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock rerank response due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (candidates.length > 0) {
      return [
        {
          contact_id: candidates[0].id,
          reason: "Mock result: AI provider not configured.",
        },
      ];
    }
    return [];
  }

  if (candidates.length === 0) return [];

  const systemPrompt = `You are a precise CRM data analyst. Given a set of candidate contacts and a natural-language query, identify which contacts DEFINITIVELY match the query.

These contacts have already been pre-filtered by a retrieval system — your job is to verify each one and return only the true matches with evidence-based reasons.

CRITICAL RULES:
1. PRECISION OVER RECALL: It is far better to miss a match than to include a false positive.
2. EVIDENCE REQUIRED: Every match must cite a specific field value from the contact data. No guessing.
3. SELF-VERIFICATION: Before including a contact, verify it truly satisfies the query. If your reason uses words like "does not", "doesn't", "no evidence", then EXCLUDE that contact.
4. NO INVENTION: Only use data present in the contact fields. Never infer or hallucinate.`;

  const prompt = `QUERY: "${query.replace(/"/g, "'")}"

CANDIDATES (${candidates.length} pre-filtered contacts):
${JSON.stringify(candidates)}

Return a JSON array of contacts that DEFINITIVELY match the query. For each match, provide a brief evidence-based reason citing the specific field value. If no candidates match, return [].`;

  const result = await provider.generate({
    systemPrompt,
    prompt,
    responseFormat: "json",
    routing: { prefer: "lite" },
    jsonSchema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["contact_id", "reason"],
      },
    },
  });

  const parsed = safeParseJson<SemanticMatchResult[]>(
    result.text,
    "rerankCandidates",
  );
  if (!parsed) return [];

  // ── Server-side false-positive filter ──────────────────────────────────
  const negativePatterns =
    /\bdoes not\b|\bdoesn't\b|\bnot a match\b|\bno evidence\b|\bnot start\b|\bunrelated\b|\bnot related\b|\bnot in\b/i;
  const filtered = parsed.filter((m) => {
    if (negativePatterns.test(m.reason)) {
      log.debug("Reranker", `Filtered false positive: "${m.reason}"`);
      return false;
    }
    // Validate the contact_id actually exists in our candidates
    if (!candidates.some((c) => c.id === m.contact_id)) {
      log.debug(
        "Reranker",
        `Filtered hallucinated contact_id: "${m.contact_id}"`,
      );
      return false;
    }
    return true;
  });

  log.info(
    "AIService",
    `Reranker "${query}" → ${filtered.length}/${candidates.length} matches ` +
      `(${parsed.length - filtered.length} filtered) in ${result.latencyMs}ms via ${result.model} | ` +
      `Tokens: ${result.tokenCount ?? "?"}`,
  );
  recordInvocation({
    operation: "rerank",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: result.latencyMs,
    cached: false,
    description: `Rerank: ${candidates.length} candidates for "${query.slice(0, 40)}"`,
  });

  return filtered;
}

/**
 * @deprecated Use `rerankCandidates()` instead. This is a backward-compat shim
 * that delegates to the new reranker. Kept for any call sites not yet migrated.
 */
export async function semanticContactSearch(
  query: string,
  contacts: CompressedContact[],
): Promise<SemanticMatchResult[]> {
  return rerankCandidates(query, contacts);
}

// =============================================================================
// 6. generateDailyInsight
// =============================================================================

export interface DailyInsight {
  text: string;
  category: string;
  generatedAt: string;
}

/**
 * Generates a single actionable insight about the user's CRM network.
 * Falls back gracefully to null if no API key is provided.
 */
export async function generateDailyInsight(stats: {
  totalContacts: number;
  industryDistribution: Record<string, number>;
  atRiskNames: string[];
  newContactsCount: number;
  topRelationships: string[];
  bottomRelationships: string[];
}): Promise<DailyInsight | null> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock Daily Insight due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    return null;
  }

  const systemPrompt = `You are a CRM intelligence analyst who helps professionals maintain stronger, more intentional relationships.
    You generate short, specific, actionable insights — never generic platitudes.`;

  const prompt = `Based on the following network statistics, generate a single actionable insight
    (1-2 sentences max) that helps the user be a better relationship-builder.
    Be specific and reference actual patterns in the data.

    Stats:
    - Total contacts: ${stats.totalContacts}
    - Industry distribution: ${JSON.stringify(stats.industryDistribution)}
    - Contacts not reached in 60+ days: ${stats.atRiskNames.join(", ") || "None"}
    - New contacts this month: ${stats.newContactsCount}
    - Most active relationships: ${stats.topRelationships.join(", ") || "None"}
    - Least active relationships: ${stats.bottomRelationships.join(", ") || "None"}
  `;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "json",
      routing: { prefer: "lite" },
      jsonSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          category: { type: "string" },
        },
        required: ["text", "category"],
      },
    });

    const parsed = safeParseJson<{ text: string; category: string }>(
      result.text,
      "generateDailyInsight",
    );
    if (!parsed) return null;

    log.info(
      "AIService",
      `generateDailyInsight → generated in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`,
    );

    recordInvocation({
      operation: "dailyInsight",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: "Daily Insight",
    });
    return {
      text: parsed.text,
      category: parsed.category,
      generatedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    log.error("AIService", "Daily insight generation failed", {
      error: getErrorMessage(error),
    });
    return null;
  }
}

// =============================================================================
// 7. bulkParseContacts
// =============================================================================

/**
 * Parse multiple unstructured contact texts in parallel with tier-aware
 * concurrency. Uses ParallelQueue to enforce concurrency limits and
 * delegates each item to `parseContactRecord` for DRY prompt/schema reuse.
 *
 * Concurrency adapts to AI_TIER automatically:
 *   - PAID → 10 concurrent workers (10K RPM headroom)
 *   - FREE → 2 concurrent workers (conservative for ~10 RPM limits)
 *
 * Individual failures are isolated — one bad text never crashes the batch.
 * Failed items return `null` in the result array.
 *
 * @param texts       - Array of unstructured text strings to parse
 * @param concurrency - Override automatic tier-based concurrency
 * @returns           - Array of parsed contacts (or null for failed items),
 *                      in the same order as the input array
 */
export async function bulkParseContacts(
  texts: string[],
  concurrency?: number,
): Promise<(ParsedContact | null)[]> {
  if (isMockMode()) {
    throw new Error("AI provider not configured. Cannot run bulk parser.");
  }

  if (texts.length === 0) return [];

  // Adapt concurrency to tier if not explicitly provided
  // Non-Gemini providers (OpenAI, Anthropic) are always paid — no RPM restrictions
  // that justify the conservative FREE tier concurrency of 2.
  const tier = getAITier();
  const providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const effectiveConcurrency =
    concurrency ?? (providerName !== "gemini" ? 10 : tier === "PAID" ? 10 : 2);

  log.info(
    "AIService",
    `bulkParseContacts: ${texts.length} items | concurrency: ${effectiveConcurrency} (${tier})`,
  );
  const startMs = Date.now();

  const results = await ParallelQueue.process(
    texts,
    effectiveConcurrency,
    async (text, index) => {
      try {
        return await parseContactRecord(text);
      } catch (error: unknown) {
        log.warn(
          "AIService",
          `bulkParseContacts: item ${index + 1}/${texts.length} failed: ${getErrorMessage(error)}`,
        );
        throw error; // ParallelQueue captures as Error in results array
      }
    },
  );

  const successes = results.filter((r) => !(r instanceof Error)).length;
  const failures = results.length - successes;

  log.info(
    "AIService",
    `bulkParseContacts: ${successes}/${texts.length} succeeded, ${failures} failed in ${Date.now() - startMs}ms`,
  );
  recordInvocation({
    operation: "bulkParse",
    latencyMs: Date.now() - startMs,
    cached: false,
    description: `Bulk Parse: ${texts.length} contacts (${successes} ok, ${failures} failed)`,
  });

  return results.map((r) => (r instanceof Error ? null : r));
}

// =============================================================================
// 9. generateSearchExpansion (Doc2Query Write-Time Enrichment)
// =============================================================================

/**
 * Generate synthetic search terms for a contact, enabling FTS5 to match
 * queries that use different vocabulary than the raw contact data.
 *
 * Example:
 *   Contact: "Jane Doe, SWE at Stripe"
 *   Expansion: "fintech, payments, coder, developer, software engineer, silicon valley, tech"
 *
 * These terms are stored in `contacts.searchExpansion` and indexed in FTS5,
 * so "Who works in fintech?" instantly matches Jane via keyword search (<1ms).
 *
 * This is called asynchronously in the background on contact create/update.
 * Uses the "lite" model class — cheap and fast.
 */
export async function generateSearchExpansion(contact: {
  name: string;
  role?: string | null;
  company?: string | null;
  industry?: string | null;
  about?: string | null;
  preferences?: string | null;
  tags?: string[];
  interests?: string[];
}): Promise<string | null> {
  if (isMockMode()) return null;

  const parts: string[] = [];
  if (contact.name) parts.push(`Name: ${contact.name}`);
  if (contact.role) parts.push(`Role: ${contact.role}`);
  if (contact.company) parts.push(`Company: ${contact.company}`);
  if (contact.industry) parts.push(`Industry: ${contact.industry}`);
  if (contact.about) parts.push(`About: ${contact.about.slice(0, 200)}`);
  if (contact.preferences)
    parts.push(`Preferences: ${contact.preferences.slice(0, 200)}`);
  if (contact.tags?.length) parts.push(`Tags: ${contact.tags.join(", ")}`);
  if (contact.interests?.length)
    parts.push(`Interests: ${contact.interests.join(", ")}`);

  if (parts.length <= 1) return null; // Name-only contacts aren't worth expanding

  try {
    const result = await provider.generate({
      systemPrompt: `You generate search expansion keywords. Given a contact profile, output a comma-separated list of 10 search terms that someone might use to find this person. Include: synonyms for their role, industry keywords, related fields, skill inferences, and location-based terms. Output ONLY the comma-separated list, nothing else.`,
      prompt: parts.join(" | "),
      responseFormat: "text",
      routing: { prefer: "lite" },
    });

    const expansion = result.text?.trim();
    if (!expansion || expansion.length > 500) return null;

    log.debug(
      "AIService",
      `Doc2Query for "${contact.name}": "${expansion.slice(0, 80)}..."`,
    );
    recordInvocation({
      operation: "searchExpansion",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `Search expansion for ${contact.name}`,
    });
    return expansion;
  } catch (err: unknown) {
    log.debug(
      "AIService",
      `Doc2Query failed for "${contact.name}": ${getErrorMessage(err)}`,
    );
    return null;
  }
}

// =============================================================================
// 10. synthesizeSearchResults (Executive Brief)
// =============================================================================

/**
 * Generates a concise 2-3 sentence executive summary of a set of AI search
 * results. This is an opt-in feature — the user clicks "Synthesize these
 * results" after seeing their matches.
 *
 * @param query    - The original user query
 * @param contacts - Compressed contact objects from the search results
 * @returns        - A plain-text executive brief
 */
export async function synthesizeSearchResults(
  query: string,
  contacts: {
    name: string;
    role?: string;
    company?: string;
    aiReason?: string;
  }[],
): Promise<string> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock synthesis due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return (
      `You have ${contacts.length} connections matching "${query}". ` +
      `Key figures include ${contacts
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ")}. ` +
      `Consider reaching out to strengthen these relationships.`
    );
  }

  // ── Cache check: same query + same result count → same synthesis
  const cacheKey = query.trim().toLowerCase().replace(/\s+/g, " ");
  const cached = aiCache.get<string>("synthesis", cacheKey);
  if (cached) {
    recordInvocation({
      operation: "synthesis",
      latencyMs: 0,
      cached: true,
      description: `Synthesis: ${query.slice(0, 40)}`,
    });
    return cached;
  }

  const contactSummaries = contacts
    .map((c) => {
      const parts = [c.name];
      if (c.role) parts.push(c.role);
      if (c.company) parts.push(`at ${c.company}`);
      if (c.aiReason) parts.push(`— ${c.aiReason}`);
      return parts.join(", ");
    })
    .join("\n");

  const systemPrompt = `You are a CRM intelligence analyst. Given a search query and matching contacts, provide a concise 2-3 sentence executive brief.

RULES:
1. Summarize WHO these people are and their commonalities.
2. Highlight the strongest connections or most notable contacts.
3. If there are actionable patterns (e.g., many at-risk contacts, industry clusters), mention them.
4. Be specific — reference actual names and data. Do NOT use generic platitudes.
5. Write in second person ("You have...", "Your strongest...").`;

  const prompt = `QUERY: "${query}"

MATCHING CONTACTS (${contacts.length} total):
${contactSummaries}

Write a 2-3 sentence executive brief.`;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "text",
      routing: { prefer: "lite" },
    });

    const text = result.text?.trim();
    if (!text) throw new Error("Empty synthesis response");

    // Cache the synthesis result
    aiCache.set("synthesis", cacheKey, text);

    log.info(
      "AIService",
      `synthesizeSearchResults "${query}" → ${text.length} chars in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`,
    );
    recordInvocation({
      operation: "synthesis",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `Synthesis: ${query.slice(0, 40)}`,
    });
    return text;
  } catch (error: unknown) {
    log.error("AIService", "Synthesis failed", {
      error: getErrorMessage(error),
    });
    throw error;
  }
}
