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

function resolveProvider(): AIProvider {
  const providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();

  switch (providerName) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "dummy_key") {
        log.warn("AIService", "GEMINI_API_KEY not configured — AI functions will use mock responses");
      }
      return new GeminiAdapter(apiKey || "dummy_key");
    }

    // Future adapters plug in here:
    // case "openai":
    //   return new OpenAIAdapter(process.env.OPENAI_API_KEY!);
    // case "anthropic":
    //   return new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!);
    // case "ollama":
    //   return new OllamaAdapter(process.env.OLLAMA_BASE_URL!);

    default:
      log.warn("AIService", `Unknown AI_PROVIDER "${providerName}", falling back to Gemini`);
      return new GeminiAdapter(process.env.GEMINI_API_KEY || "dummy_key");
  }
}

const provider = resolveProvider();
log.info("AIService", `Initialized with provider: ${provider.name}`);

// ---------------------------------------------------------------------------
// Helper: Mock guard
// ---------------------------------------------------------------------------

function isMockMode(): boolean {
  return !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy_key";
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
    throw new Error("GEMINI_API_KEY is missing from environment. Cannot run Auto-Parser.");
  }

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

  if (!result.text) {
    throw new Error("No text response from AI provider");
  }

  const parsed: ParsedContact = JSON.parse(result.text);
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
export async function generateCatchMeUpBriefing(contact: any, interactions: any[]): Promise<string[]> {
  if (isMockMode()) {
    log.warn("AIService", "Using mock AI Briefing due to missing GEMINI_API_KEY");
    await new Promise(resolve => setTimeout(resolve, 1500));
    return [
      "Met at the Design Systems Conference last year; he expressed strong interest in component-driven architecture.",
      "Need to close the loop on the draft proposal for the new Nexus design system integration.",
      "Icebreaker: Ask how his studio in Copenhagen is holding up with the recent sudden weather shift!",
    ];
  }

  const prompt = `
    You are an elite executive assistant setting up a brief for your principal before a meeting.
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
    prompt,
    responseFormat: "json",
    jsonSchema: {
      type: "array",
      items: { type: "string" },
    },
  });

  if (!result.text) {
    throw new Error("No text response from AI provider");
  }

  const parsed: string[] = JSON.parse(result.text);
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
    log.warn("AIService", "Using mock AI Mentions due to missing GEMINI_API_KEY");
    await new Promise(resolve => setTimeout(resolve, 1500));
    return [];
  }

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

    if (!result.text) {
      return [];
    }

    const parsed: MentionEntity[] = JSON.parse(result.text);
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
    log.warn("AIService", "Using mock EML summary due to missing GEMINI_API_KEY");
    await new Promise(resolve => setTimeout(resolve, 1500));
    return "<p><strong>Re: Q3 Roadmap Planning</strong></p><p>Thread summary:</p><ul><li>Julian proposed pushing the V2 alpha back by two weeks.</li><li>Sarah agreed to coordinate with marketing.</li><li>John provided the final wireframe mocks for the reporting suite.</li></ul>";
  }

  const prompt = `
    You are an expert executive assistant processing a raw .eml email export file.
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
 * Token budget (approx): ~120 bytes / contact × 500 contacts = ~60 KB
 * ≈ 15,000 tokens — well within gemini-flash's 1M context window.
 */
export async function semanticContactSearch(
  query: string,
  contacts: CompressedContact[]
): Promise<SemanticMatchResult[]> {
  // Mock path — no API key
  if (isMockMode()) {
    log.warn("AIService", "Using mock semantic response due to missing GEMINI_API_KEY");
    await new Promise(resolve => setTimeout(resolve, 800));
    if (contacts.length > 0) {
      return [{ contact_id: contacts[0].id, reason: "Mock result: API key not configured." }];
    }
    return [];
  }

  const contextJson = JSON.stringify(contacts);

  const prompt = `
You are an expert CRM data analyst. You have been given a JSON array of contacts from a personal CRM database.
Each contact may have: id, name, role, company, location, about, industry, preferences, interests (tags).

Your task: Analyze the user's natural-language query and identify ALL contacts from the provided array that
meaningfully answer the question. Be thorough but precise — only include genuine matches.

For each match, provide a single concise sentence (max 15 words) explaining exactly why this specific
contact answers the query (reference specific data fields, e.g. "Listed espresso as a preference" or
"Works in FinTech at Barclays, London").

If no contacts match the query, return an empty array [].
Do NOT invent information not present in the data. Only cite what exists in the contact fields.

USER QUERY: "${query.replace(/"/g, "'")}"

CRM CONTACTS (${contacts.length} active, non-ghost):
${contextJson}
  `.trim();

  const result = await provider.generate({
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

  if (!result.text) {
    return [];
  }

  const parsed: SemanticMatchResult[] = JSON.parse(result.text);
  log.info(
    "AIService",
    `Semantic search "${query}" → ${parsed.length} matches in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"} | Contacts scanned: ${contacts.length}`
  );

  return parsed;
}
