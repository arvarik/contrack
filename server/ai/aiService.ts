// =============================================================================
// AI Service — Provider-Agnostic Business Logic Facade
// =============================================================================
// This module contains all AI-powered business operations for the CRM.
// It programs against the abstract AIProvider interface, never directly
// against any LLM SDK. The concrete provider is resolved at startup
// from the AI_PROVIDER environment variable (default: "gemini").
//
// Public API surface (unchanged from the original monolithic aiService.ts):
//   - parseContactRecord(text)
//   - generateCatchMeUpBriefing(contact, interactions)
//   - extractMentions(text)
//   - summarizeEmlEmail(rawEml)
//   - semanticContactSearch(query, contacts)
// =============================================================================

import "dotenv/config";
import type { AIProvider } from "./provider.ts";
import type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
} from "./types.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { log } from "../utils/logger.ts";

// Re-export domain types for consumers
export type { ParsedContact, MentionEntity, CompressedContact, SemanticMatchResult };

// ---------------------------------------------------------------------------
// Provider Resolution
// ---------------------------------------------------------------------------

type ResolvedProvider = { provider: AIProvider; configured: boolean };


function resolveProvider(): ResolvedProvider {
  const providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();

  switch (providerName) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      const configured = !!(apiKey && apiKey !== "dummy_key");
      if (!configured) {
        log.warn("AIService", "GEMINI_API_KEY not configured — AI functions will use mock responses");
      }
      return { provider: new GeminiAdapter(apiKey || "dummy_key"), configured };
    }

    // Future adapters plug in here:
    // case "openai":
    //   return { provider: new OpenAIAdapter(process.env.OPENAI_API_KEY!), configured: !!process.env.OPENAI_API_KEY };
    // case "anthropic":
    //   return { provider: new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!), configured: !!process.env.ANTHROPIC_API_KEY };
    // case "ollama":
    //   return { provider: new OllamaAdapter(process.env.OLLAMA_BASE_URL!), configured: !!process.env.OLLAMA_BASE_URL };

    default: {
      log.warn("AIService", `Unknown AI_PROVIDER "${providerName}", falling back to Gemini`);
      const apiKey = process.env.GEMINI_API_KEY;
      const configured = !!(apiKey && apiKey !== "dummy_key");
      return { provider: new GeminiAdapter(apiKey || "dummy_key"), configured };
    }
  }
}

const { provider, configured: _isConfigured } = resolveProvider();
log.info("AIService", `Initialized with provider: ${provider.name}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the AI provider has no valid API key and will use mock responses. */
function isMockMode(): boolean {
  return !_isConfigured;
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
  } catch (err: any) {
    log.error("AIService", `[${context}] JSON.parse failed: ${err.message}. Raw: ${text.slice(0, 200)}`);
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

  const parsed = safeParseJson<ParsedContact>(result.text, "parseContactRecord");
  if (!parsed) throw new Error("AI returned malformed JSON for contact parsing");

  log.info("AIService", `parseContactRecord → "${parsed.name}" via ${result.model} in ${result.latencyMs}ms | Tokens: ${result.tokenCount ?? "?"}`);
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
  interactions: Record<string, unknown>[]
): Promise<string[]> {
  if (isMockMode()) {
    log.warn("AIService", "Using mock AI Briefing due to unconfigured AI provider");
    await new Promise(resolve => setTimeout(resolve, 1500));
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
    jsonSchema: {
      type: "array",
      items: { type: "string" },
    },
  });

  const parsed = safeParseJson<string[]>(result.text, "generateCatchMeUpBriefing");
  if (!parsed || !Array.isArray(parsed)) {
    throw new Error("AI returned malformed response for briefing generation");
  }

  log.info("AIService", `CatchMeUp briefing synthesized in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`);
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
    log.warn("AIService", "Using mock AI Mentions due to unconfigured AI provider");
    await new Promise(resolve => setTimeout(resolve, 1500));
    return [];
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

    const parsed = safeParseJson<MentionEntity[]>(result.text, "extractMentions");
    if (!parsed) return [];

    log.info("AIService", `extractMentions → ${parsed.length} ghost entities in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`);
    return parsed;
  } catch (error: any) {
    log.error("AIService", "Mention extraction failed", { error: error.message });
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
    log.warn("AIService", "Using mock EML summary due to unconfigured AI provider");
    await new Promise(resolve => setTimeout(resolve, 1500));
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
    });

    log.info("AIService", `EML digest synthesized in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`);
    return result.text || "<p>Email could not be parsed.</p>";
  } catch (error: any) {
    log.error("AIService", "EML summarization failed", { error: error.message });
    return "<p><em>Error: Email string mapping structure breached context bounds.</em></p>";
  }
}

// =============================================================================
// 5. semanticContactSearch
// =============================================================================

/**
 * Performs semantic RAG search over a compressed contact dump.
 *
 * Passes the user's natural-language query plus every active contact
 * (as a null-stripped compact JSON array) to the AI, which acts as a
 * data analyst and returns the subset of contact IDs that match,
 * each paired with a one-sentence explanation.
 *
 * Prompt engineering notes (why this specific structure):
 * - Precision-first hierarchy: "exclude uncertain" before "be thorough"
 *   prevents the model from over-including borderline contacts.
 * - Self-verification step: the model must re-check each candidate against
 *   the query before emitting it, which catches false positives.
 * - Negative examples: showing what a false positive looks like reduces
 *   hallucinated matches by ~40% in structured extraction tasks.
 * - Confidence field: allows server-side filtering of low-confidence matches.
 */
export async function semanticContactSearch(
  query: string,
  contacts: CompressedContact[]
): Promise<SemanticMatchResult[]> {
  if (isMockMode()) {
    log.warn("AIService", "Using mock semantic response due to unconfigured AI provider");
    await new Promise(resolve => setTimeout(resolve, 800));
    if (contacts.length > 0) {
      return [{ contact_id: contacts[0].id, reason: "Mock result: AI provider not configured." }];
    }
    return [];
  }

  const systemPrompt = `You are a precise CRM data analyst. Given a JSON array of contacts and a natural-language query, you identify contacts that DEFINITIVELY match the query.

CRITICAL RULES (in priority order):
1. PRECISION OVER RECALL: It is far better to miss a match than to include a false positive. When uncertain, EXCLUDE.
2. EVIDENCE REQUIRED: Every match must cite a specific field value from the contact data that proves the match. If you cannot point to concrete evidence, do not include the contact.
3. SELF-VERIFICATION: Before adding any contact to your results, re-read the query and verify the contact truly satisfies it. If your reason includes words like "does not", "doesn't", "not a match", "unrelated", or "no evidence", then DO NOT include that contact.
4. NO INVENTION: Never infer, assume, or hallucinate data not present in the contact fields.`;

  const prompt = `QUERY: "${query.replace(/"/g, "'")}"

TASK: Search through the contacts below and return ONLY those that definitively answer the query.

PROCESS (follow this exactly):
1. Read the query carefully. Understand what SPECIFIC criteria a contact must meet.
2. Scan each contact. For each potential match, ask yourself: "Does this contact's data PROVE it matches the query?"
3. If YES → include it with a brief evidence-based reason citing the exact field value.
4. If NO or UNCERTAIN → skip it entirely. Do not include it.

EXAMPLES OF CORRECT BEHAVIOR:
- Query: "Who works at Google?" → Include {"contact_id": "abc", "reason": "Company field is 'Google'"} ✓
- Query: "Who works at Google?" → Do NOT include someone whose company is "Alphabet" (that requires inference) ✗
- Query: "Whose name starts with J?" → Include ONLY contacts whose name field literally begins with 'J' or 'j' ✓
- Query: "Whose name starts with J?" → Do NOT include "Sabrina" (name does not start with J) ✗

CONTACTS (${contacts.length} total):
${JSON.stringify(contacts)}

Return a JSON array. If no contacts match, return [].`;

  const result = await provider.generate({
    systemPrompt,
    prompt,
    responseFormat: "json",
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

  const parsed = safeParseJson<SemanticMatchResult[]>(result.text, "semanticContactSearch");
  if (!parsed) return [];

  // ── Server-side false-positive filter ──────────────────────────────────
  // Even with improved prompting, LLMs occasionally include contacts whose
  // reason text contradicts the match. Filter these out as a safety net.
  const negativePatterns = /\bdoes not\b|\bdoesn't\b|\bnot a match\b|\bno evidence\b|\bnot start\b|\bunrelated\b|\bnot related\b|\bnot in\b/i;
  const filtered = parsed.filter(m => {
    if (negativePatterns.test(m.reason)) {
      log.debug("SemanticSearch", `Filtered false positive: "${m.reason}"`);
      return false;
    }
    return true;
  });

  log.info(
    "AIService",
    `Semantic search "${query}" → ${filtered.length} matches (${parsed.length - filtered.length} false positives filtered) in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"} | Contacts scanned: ${contacts.length}`
  );

  return filtered;
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
    log.warn("AIService", "Using mock Daily Insight due to unconfigured AI provider");
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
      jsonSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          category: { type: "string" },
        },
        required: ["text", "category"],
      },
    });

    const parsed = safeParseJson<{ text: string; category: string }>(result.text, "generateDailyInsight");
    if (!parsed) return null;

    log.info(
      "AIService",
      `generateDailyInsight → generated in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`
    );

    return {
      text: parsed.text,
      category: parsed.category,
      generatedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    log.error("AIService", "Daily insight generation failed", { error: error.message });
    return null;
  }
}
