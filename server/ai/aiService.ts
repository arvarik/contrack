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
//   - generateDailyInsight(stats)
//   - bulkParseContacts(texts, concurrency?)
// =============================================================================

import "dotenv/config";
import type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
  ParsedSearchQuery,
  QueryPlan,
} from "./types.ts";
import { sharedProvider, isProviderConfigured } from "./singleton.ts";
import { ParallelQueue } from "./routing/ParallelQueue.ts";
import { getAITier } from "./routing/registry.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { recordInvocation } from "../services/aiStatsService.ts";
import { aiCache, contentHash } from "../utils/aiCache.ts";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "./promptSafety.ts";

// Re-export domain types for consumers
export type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
  ParsedSearchQuery,
  QueryPlan,
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
    You NEVER invent or infer data not explicitly stated in the text.

${UNTRUSTED_DATA_RULE}`;

  const prompt = `
    Extract contact information from the following unstructured text. 
    Map it to the structured schema reliably. If a field cannot be derived, omit it (leave it null/empty).
    For firstName and lastName, split from the full name if possible.
    For headline, extract a professional headline or tagline if present.
    For industry, extract the industry vertical if mentioned.
    For experience entries, try to determine if a role is current (isCurrent).
    For education entries, try to extract the field of study separately from degree.

    ${wrapUntrusted("contact text payload", text)}
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

  const systemPrompt = `${UNTRUSTED_DATA_RULE}

You are an elite executive assistant preparing a meeting brief.
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

    ${wrapUntrusted("contact profile JSON", JSON.stringify(contact, null, 2))}

    ${wrapUntrusted("recent timeline JSON", JSON.stringify(interactions, null, 2), 16_000)}
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
    description: `Catch-Me-Up for ${typeof contact.name === "string" && contact.name ? contact.name : "contact"}`,
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

  const systemPrompt = `${UNTRUSTED_DATA_RULE}

You are an expert executive assistant processing raw email exports.
    You distill email threads into clean, highly legible HTML summaries.
    You strip all MIME headers, legal footers, and security scanner additions.`;

  const prompt = `
    The user has exported an email thread and dropped it into the CRM.
    
    1. Parse the thread and identify the core subject, participants, and flow.
    2. Completely ignore and strip out all raw MIME boundaries, headers, legal disclaimers, signature blocks, and security scanning footers.
    3. Provide a highly legible, synthesized summary of the ACTUAL conversation thread. Do not just blindly copy the text. Distill it.
    4. Provide the final output as a clean HTML string. Use <ul>, <li>, <p>, and <strong> tags to make it ultra-readable inside a custom UI component pane. Do NOT wrap it in "html", "head", or "body" tags. Only return the inner content elements.
    
    ${wrapUntrusted("raw .eml file", rawEml, 24_000)}
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
  plan?: QueryPlan | null,
  signal?: AbortSignal,
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

  // Build a human-readable description of the QueryPlan that the reranker
  // must verify against. Each must.* dimension becomes an explicit
  // verification checklist item, and the reranker is told to refuse any
  // candidate it cannot ground in a literal field value.
  const planDirectives: string[] = [];
  if (plan?.must.locationMatchers?.length) {
    planDirectives.push(
      `LOCATION: contact.location must mention one of these strings (case-insensitive, word-boundary): ${plan.must.locationMatchers.slice(0, 60).join(", ")}`,
    );
  }
  if (plan?.must.companyMatchers?.length) {
    planDirectives.push(
      `COMPANY: contact.company must mention one of: ${plan.must.companyMatchers.join(", ")}`,
    );
  }
  if (plan?.must.roleMatchers?.length) {
    planDirectives.push(
      `ROLE: contact.role or contact.headline must mention one of: ${plan.must.roleMatchers.join(", ")}`,
    );
  }
  if (plan?.must.industryMatchers?.length) {
    planDirectives.push(
      `INDUSTRY: contact.industry or interests must mention one of: ${plan.must.industryMatchers.join(", ")}`,
    );
  }
  const hasHardConstraints = planDirectives.length > 0;

  const systemPrompt = `${UNTRUSTED_DATA_RULE}

You are a precise CRM data analyst. You verify whether each candidate contact DEFINITIVELY matches a user query, and you cite the specific field value that proves it.

These contacts have already been pre-filtered by a retrieval system — your job is the LAST line of defense against false positives. Be ruthlessly precise.

OUTPUT SHAPE (per match):
  {
    "contact_id": "<id from candidate>",
    "verified_field": "<exact field name like 'location' or 'company'>",
    "verified_value": "<EXACT substring from that field that proves the match>",
    "reason": "<one short third-person sentence ABOUT the contact — never address the user>"
  }

REASON STYLE:
- Third person, describing the contact. Start with their name OR an impersonal descriptor.
- ✓ "John is based in Los Angeles, California."
- ✓ "Located in Chicago, Illinois — a US city."
- ✓ "Works as a VC at Sequoia Capital."
- ✗ "You are located in California..." (wrong subject — this isn't about the user)
- ✗ "Your contact in California..." (still addresses the user)
- Keep it under ~15 words.

CRITICAL RULES (in priority order):
1. EVIDENCE OR EXCLUDE: \`verified_value\` MUST be a literal substring of the named field. If the candidate has no such substring, OMIT them entirely. Do not approximate, do not infer, do not paraphrase.
2. ${hasHardConstraints ? "EVERY HARD CONSTRAINT must be satisfied — see below. A contact failing ANY constraint must be excluded." : "Match the query intent — common sense applies."}
3. NO TENSE-DETECTION: prior employment ("ex-Stripe") is NOT a current-company match unless the query asks about ex-employees.
4. EMPTY FIELDS NEVER QUALIFY: if a candidate has no \`location\`, they cannot match a location query. Exclude them.
5. PRECISION OVER RECALL: returning 5 verified matches is better than 30 noisy ones.${
    hasHardConstraints
      ? `

HARD CONSTRAINTS for THIS QUERY (you must verify EACH for EVERY match):
${planDirectives.map((d, i) => `${i + 1}. ${d}`).join("\n")}

A contact that fails any hard constraint MUST be excluded, regardless of how well other fields match.`
      : ""
  }`;

  const prompt = `QUERY: "${query.replace(/"/g, "'")}"
${plan?.rationale ? `\nPLANNER RATIONALE: ${plan.rationale}` : ""}

CANDIDATES (${candidates.length}):
${wrapUntrusted("candidate contacts JSON", JSON.stringify(candidates), 24_000)}

Return a JSON array of VERIFIED matches with field-level evidence. If no candidate can be grounded, return [].`;

  const result = await provider.generate({
    systemPrompt,
    prompt,
    responseFormat: "json",
    routing: { prefer: "lite" },
    signal,
    jsonSchema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          verified_field: { type: "string" },
          verified_value: { type: "string" },
          reason: { type: "string" },
        },
        required: ["contact_id", "verified_field", "verified_value", "reason"],
      },
    },
  });

  interface VerifiedMatch extends SemanticMatchResult {
    verified_field?: string;
    verified_value?: string;
  }

  const parsed = safeParseJson<VerifiedMatch[]>(
    result.text,
    "rerankCandidates",
  );
  if (!parsed) return [];

  // ── Server-side evidence verification ───────────────────────────────────
  // We re-check the LLM's claimed evidence against the actual candidate
  // data to catch hallucinations and ungrounded matches. Three checks:
  //  1. contact_id must exist in our candidate set
  //  2. verified_value must be a literal substring of the named field
  //  3. if a hard constraint applies to that field, the value must satisfy it
  const reasonNegativePattern =
    /\bdoes not\b|\bdoesn't\b|\bno evidence\b|\bunrelated\b|\bnot related\b|\bnot in\b|\bnot a match\b/i;

  const wordBoundaryMatch = (haystack: string, needle: string): boolean => {
    if (!haystack || !needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^a-zA-Z0-9])${escaped}(?=[^a-zA-Z0-9]|$)`,
      "i",
    ).test(haystack);
  };

  const filtered: SemanticMatchResult[] = [];
  let droppedNoEvidence = 0;
  let droppedHardConstraint = 0;
  let droppedNegativeReason = 0;
  let droppedHallucinated = 0;

  for (const m of parsed) {
    const cand = candidates.find((c) => c.id === m.contact_id);
    if (!cand) {
      droppedHallucinated++;
      continue;
    }

    if (reasonNegativePattern.test(m.reason ?? "")) {
      droppedNegativeReason++;
      continue;
    }

    // Verify the claimed evidence: the verified_value must actually appear
    // in the candidate's named field. This catches the LLM saying "lives
    // in California" for a contact whose location is "Sydney".
    const field = (m.verified_field ?? "").toLowerCase();
    const value = (m.verified_value ?? "").trim();
    const candAsRecord = cand as unknown as Record<string, unknown>;
    const fieldVal =
      typeof candAsRecord[field] === "string"
        ? (candAsRecord[field] as string)
        : "";

    if (
      !value ||
      !fieldVal ||
      !fieldVal.toLowerCase().includes(value.toLowerCase())
    ) {
      droppedNoEvidence++;
      log.debug(
        "Reranker",
        `Dropped ${cand.name}: claimed ${field}="${value}" not found in actual ${field}="${fieldVal}"`,
      );
      continue;
    }

    // If the query plan has a hard constraint on this field, verify the
    // candidate's actual field satisfies AT LEAST ONE matcher. This is the
    // last-mile safety net beyond the pre-filter.
    if (plan?.must.locationMatchers?.length && cand.location) {
      const ok = plan.must.locationMatchers.some((mat) =>
        wordBoundaryMatch(cand.location ?? "", mat),
      );
      if (!ok) {
        droppedHardConstraint++;
        log.debug(
          "Reranker",
          `Dropped ${cand.name}: location "${cand.location}" fails locationMatchers`,
        );
        continue;
      }
    } else if (plan?.must.locationMatchers?.length && !cand.location) {
      droppedHardConstraint++;
      continue;
    }
    if (plan?.must.companyMatchers?.length && cand.company) {
      const ok = plan.must.companyMatchers.some((mat) =>
        wordBoundaryMatch(cand.company ?? "", mat),
      );
      if (!ok) {
        droppedHardConstraint++;
        continue;
      }
    }
    if (plan?.must.roleMatchers?.length) {
      const ok = plan.must.roleMatchers.some(
        (mat) =>
          wordBoundaryMatch(cand.role ?? "", mat) ||
          wordBoundaryMatch((candAsRecord["headline"] as string) ?? "", mat),
      );
      if (!ok) {
        droppedHardConstraint++;
        continue;
      }
    }

    filtered.push({ contact_id: m.contact_id, reason: m.reason });
  }

  log.info(
    "AIService",
    `Reranker "${query}" → ${filtered.length}/${candidates.length} verified ` +
      `(LLM said ${parsed.length}, dropped: ${droppedNoEvidence} no-evidence, ` +
      `${droppedHardConstraint} hard-constraint, ${droppedNegativeReason} negative, ${droppedHallucinated} hallucinated) ` +
      `in ${result.latencyMs}ms via ${result.model} | Tokens: ${result.tokenCount ?? "?"}`,
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
      systemPrompt: `${UNTRUSTED_DATA_RULE}

You generate search expansion keywords. Given a contact profile, output a comma-separated list of 10 search terms that someone might use to find this person. Include: synonyms for their role, industry keywords, related fields, skill inferences, and location-based terms. Output ONLY the comma-separated list, nothing else.`,
      prompt: wrapUntrusted("contact profile", parts.join(" | ")),
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
    location?: string;
    aiReason?: string;
  }[],
  plan?: QueryPlan | null,
): Promise<string> {
  if (isMockMode()) {
    log.warn(
      "AIService",
      "Using mock synthesis due to unconfigured AI provider",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (contacts.length === 0) {
      return `No contacts matched "${query}". Try rephrasing or broadening the search.`;
    }
    return (
      `You have ${contacts.length} connections matching "${query}". ` +
      `Key figures include ${contacts
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ")}. ` +
      `Consider reaching out to strengthen these relationships.`
    );
  }

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

  if (contacts.length === 0) {
    return `No contacts matched "${query}". Try rephrasing or broadening the search.`;
  }

  // Render contacts with location explicitly so the LLM can ground geographic
  // claims against literal field values rather than vibes.
  const contactSummaries = contacts
    .map((c) => {
      const parts = [c.name];
      if (c.role) parts.push(c.role);
      if (c.company) parts.push(`at ${c.company}`);
      if (c.location) parts.push(`[location: ${c.location}]`);
      if (c.aiReason) parts.push(`— ${c.aiReason}`);
      return parts.join(", ");
    })
    .join("\n");

  // Build a grounding statement from the plan so the LLM understands what
  // filter actually applies — and is held accountable to it. Without this
  // the synthesis says things like "30 contacts in America" without
  // verifying each contact's location.
  const grounding: string[] = [];
  if (plan?.must.locationMatchers?.length) {
    grounding.push(
      `Every contact in the list has been verified to mention one of these location strings: ${plan.must.locationMatchers.slice(0, 20).join(", ")}${plan.must.locationMatchers.length > 20 ? "..." : ""}.`,
    );
  }
  if (plan?.must.companyMatchers?.length) {
    grounding.push(
      `Each contact's company matches one of: ${plan.must.companyMatchers.join(", ")}.`,
    );
  }
  if (plan?.must.roleMatchers?.length) {
    grounding.push(
      `Each contact's role matches one of: ${plan.must.roleMatchers.join(", ")}.`,
    );
  }
  if (plan?.must.industryMatchers?.length) {
    grounding.push(
      `Each contact's industry matches one of: ${plan.must.industryMatchers.join(", ")}.`,
    );
  }

  const systemPrompt = `${UNTRUSTED_DATA_RULE}

You are a CRM intelligence analyst. You produce a 2-3 sentence grounded executive brief about a set of contacts that match a query.

CRITICAL GROUNDING RULES:
1. NEVER make a claim that does not apply to AT LEAST 80% of the contacts shown. If you say "based in America", check every contact's [location:] tag.
2. NEVER invent fields you can't see. No claims about industries, roles, or seniority unless they appear in the contact summaries.
3. If contacts span multiple regions, industries, or companies, SAY SO — do not project a false homogeneity.
4. Write in second person ("You have...", "Your strongest...").
5. Be specific: cite actual names where useful.
6. If the contact list is small (≤3) or heterogeneous, just describe each briefly.

BAD example (hallucination):
  Query: "Who lives in America?" with contacts [Alice (LA), Bob (Sydney)]
  ❌ "You have 2 contacts based in America..." (Bob isn't)
GOOD example (grounded):
  ✓ "You have 2 contacts: Alice in LA and Bob in Sydney. Despite the query, one is outside the US."`;

  const prompt = `QUERY: "${query}"
${grounding.length ? `\nVERIFIED FILTER:\n${grounding.join("\n")}` : ""}

MATCHING CONTACTS (${contacts.length} total):
${wrapUntrusted("contact summaries", contactSummaries, 24_000)}

Write a 2-3 sentence executive brief. Every claim must be true for the contacts shown.`;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "text",
      routing: { prefer: "lite" },
    });

    const text = result.text?.trim();
    if (!text) throw new Error("Empty synthesis response");

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

// =============================================================================
// 11. parseSearchQuery (Ask Contrack — Query Understanding, v5 Plan/Filter)
// =============================================================================

/**
 * Parse a natural-language Ask Contrack query into a structured QueryPlan.
 *
 * Architectural role (v5 Plan → Filter → Rank → Verify):
 *   The plan is the SOURCE OF TRUTH for what the user wants. The retrieval
 *   layer enforces `must.*Matchers` as hard pre-filters; the reranker uses
 *   the plan to verify each candidate; the synthesizer uses the plan to
 *   stay grounded.
 *
 * The LLM is responsible for *expanding* each concept into a synonym set
 * the retrieval layer can word-boundary match against the relevant column.
 * Example for "Who lives in America?":
 *   {
 *     must: {
 *       locationMatchers: ["United States","USA","U.S.","U.S.A.","America",
 *         "Alabama","Alaska",...,"Wyoming","DC","San Francisco","Los Angeles",
 *         "New York","Chicago","Boston","Miami","Austin","Seattle","CA","NY",
 *         "TX","FL","IL",...]
 *     },
 *     should: {},
 *     confidence: "high",
 *     rationale: "Geographic intent: contacts in the United States."
 *   }
 *
 * Returns `null` on mock-mode or LLM failure — callers should treat that
 * as "no plan available" and run the legacy hybrid search without hard
 * filters (FTS + vector only).
 *
 * Cached by content-hash for 24h — a query parse is a pure function of
 * the query string.
 */
export async function parseSearchQuery(
  query: string,
): Promise<QueryPlan | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const cacheKey = contentHash(trimmed.toLowerCase());
  const cached = aiCache.get<QueryPlan>("queryParse", cacheKey);
  if (cached) {
    recordInvocation({
      operation: "queryParse",
      latencyMs: 0,
      cached: true,
      description: `QueryParse cache hit: "${trimmed.slice(0, 40)}"`,
    });
    return cached;
  }

  if (isMockMode()) return null;

  const systemPrompt = `You are a query planner for a personal CRM. You convert natural-language queries into a structured QueryPlan that downstream retrieval will use to filter and rank contacts.

Your output drives the retrieval. \`must.*Matchers\` lists are applied as HARD pre-filters via word-boundary substring matching on the named contact field. \`should.traits\` is a soft boost. Be EXHAUSTIVE inside each matcher list — include every reasonable synonym, abbreviation, region member, or canonical form a contact's field might literally contain.

================================
WHEN TO USE EACH BUCKET
================================
- LOCATION (must.locationMatchers): use whenever the query names a place, region, or country. Expand the location into ALL literal strings a contact's \`location\` field could plausibly contain:
  * Country names + ISO codes ("United States", "USA", "U.S.", "U.S.A.", "America")
  * Sub-regions for countries (US states with full names AND 2-letter codes; UK constituent countries; etc.)
  * Major cities in the region
  * Common nicknames ("the bay" → "San Francisco", "Bay Area")
  Example "America" → ["United States","USA","U.S.","U.S.A.","America","Alabama","AL","Alaska","AK","Arizona","AZ","Arkansas","AR","California","CA","Colorado","CO","Connecticut","CT","Delaware","DE","Florida","FL","Georgia","GA","Hawaii","HI","Idaho","ID","Illinois","IL","Indiana","IN","Iowa","IA","Kansas","KS","Kentucky","KY","Louisiana","LA","Maine","ME","Maryland","MD","Massachusetts","MA","Michigan","MI","Minnesota","MN","Mississippi","MS","Missouri","MO","Montana","MT","Nebraska","NE","Nevada","NV","New Hampshire","NH","New Jersey","NJ","New Mexico","NM","New York","NY","North Carolina","NC","North Dakota","ND","Ohio","OH","Oklahoma","OK","Oregon","OR","Pennsylvania","PA","Rhode Island","RI","South Carolina","SC","South Dakota","SD","Tennessee","TN","Texas","TX","Utah","UT","Vermont","VT","Virginia","VA","Washington","WA","West Virginia","WV","Wisconsin","WI","Wyoming","WY","DC","District of Columbia","San Francisco","Los Angeles","New York","Chicago","Houston","Phoenix","Philadelphia","San Diego","Dallas","Austin","Jacksonville","Boston","Detroit","Atlanta","Miami","Seattle","Denver","Portland","Nashville","San Antonio"]

- COMPANY (must.companyMatchers): use when the query names a specific employer. Skip generic phrases ("a startup", "some firm").

- ROLE (must.roleMatchers): use when the query names a job function or title. Include synonyms:
  * "founders" → ["Founder","Co-Founder","Cofounder","CEO","Founding"]
  * "engineers" → ["Engineer","Developer","SWE","Software Engineer","Programmer","Coder","Engineering"]
  * "VCs" → ["VC","Venture Capitalist","Investor","Partner","General Partner","GP","Associate","Principal"]

- INDUSTRY (must.industryMatchers): use when the query names a sector or vertical. Include sub-fields:
  * "fintech" → ["Fintech","FinTech","Finance","Payments","Banking","DeFi","Crypto"]
  * "climate" → ["Climate","ClimateTech","Sustainability","Green","Cleantech","Renewable","ESG"]

- TEMPORAL (must.temporal): only when the query references recency ("haven't talked to in 6 months" → {type:"lastContact",daysAgo:180}).

- TRAITS (should.traits): use for descriptive intent that doesn't fit above — interests ("loves climbing"), credentials ("PhD"), seniority adjectives ("senior"), personality ("extroverted"). Each trait is its own short phrase.

================================
CONFIDENCE RULES
================================
- "high": the query has clear structured intent ("who lives in X", "VCs at Y", "founders in fintech"). Hard filters will be enforced.
- "medium": query has structured intent but with ambiguity. Hard filters apply but reranker is more lenient.
- "low": vague/exploratory ("interesting people", "show me my network"). NO must.* should be populated — return empty must:{} and treat everything as soft signals.

================================
CRITICAL
================================
- For names of people ("Find John", "Tell me about Jane Smith") → confidence: "high", populate NO must.*, leave the FTS layer to handle name matching. (Names are handled by FTS5 keyword match, not by structured filters.)
- Word-boundary matching is used — emit 2-letter state codes ("CA", "NY") freely; they won't match inside "Casablanca".
- Be exhaustive. Missing a synonym is worse than including an unlikely one.
- \`rationale\` is one sentence summarizing what you inferred.`;

  const prompt = `Query: "${trimmed}"

Return the structured QueryPlan JSON.`;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "json",
      routing: { prefer: "lite" },
      timeoutMs: 6_000,
      jsonSchema: {
        type: "object",
        properties: {
          must: {
            type: "object",
            properties: {
              locationMatchers: { type: "array", items: { type: "string" } },
              companyMatchers: { type: "array", items: { type: "string" } },
              roleMatchers: { type: "array", items: { type: "string" } },
              industryMatchers: { type: "array", items: { type: "string" } },
              temporal: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["lastContact", "neverContacted"],
                  },
                  daysAgo: { type: "integer" },
                },
                required: ["type"],
              },
            },
          },
          should: {
            type: "object",
            properties: {
              traits: { type: "array", items: { type: "string" } },
            },
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          rationale: { type: "string" },
        },
        required: ["must", "should", "confidence", "rationale"],
      },
    });

    const raw = safeParseJson<QueryPlan>(result.text, "parseSearchQuery");
    if (!raw) return null;

    // Defensive cleaning — strip empties so downstream can treat presence
    // as "filter is active". An empty list shouldn't gate anything.
    const cleanList = (xs: unknown): string[] | undefined => {
      if (!Array.isArray(xs)) return undefined;
      const out = xs
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0);
      return out.length > 0 ? out : undefined;
    };

    const cleaned: QueryPlan = {
      must: {},
      should: {},
      confidence:
        raw.confidence === "high" ||
        raw.confidence === "medium" ||
        raw.confidence === "low"
          ? raw.confidence
          : "medium",
      rationale:
        typeof raw.rationale === "string" && raw.rationale.length < 300
          ? raw.rationale.trim()
          : "",
    };

    // Low-confidence queries skip hard filters entirely — they're treated
    // as exploratory, only the soft boosts remain. This protects against
    // the planner over-extracting on ambiguous queries.
    if (cleaned.confidence !== "low" && raw.must) {
      const loc = cleanList(raw.must.locationMatchers);
      if (loc) cleaned.must.locationMatchers = loc;
      const co = cleanList(raw.must.companyMatchers);
      if (co) cleaned.must.companyMatchers = co;
      const role = cleanList(raw.must.roleMatchers);
      if (role) cleaned.must.roleMatchers = role;
      const ind = cleanList(raw.must.industryMatchers);
      if (ind) cleaned.must.industryMatchers = ind;
      if (raw.must.temporal?.type) cleaned.must.temporal = raw.must.temporal;
    }

    if (raw.should) {
      const traits = cleanList(raw.should.traits);
      if (traits) cleaned.should.traits = traits;
    }

    aiCache.set("queryParse", cacheKey, cleaned);

    log.debug(
      "AIService",
      `parseSearchQuery "${trimmed.slice(0, 50)}" → conf=${cleaned.confidence} ` +
        `loc:${cleaned.must.locationMatchers?.length ?? 0} ` +
        `co:${cleaned.must.companyMatchers?.length ?? 0} ` +
        `role:${cleaned.must.roleMatchers?.length ?? 0} ` +
        `ind:${cleaned.must.industryMatchers?.length ?? 0} ` +
        `traits:${cleaned.should.traits?.length ?? 0} ` +
        `in ${result.latencyMs}ms via ${result.model}`,
    );
    recordInvocation({
      operation: "queryParse",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `QueryParse: "${trimmed.slice(0, 40)}"`,
    });
    return cleaned;
  } catch (err: unknown) {
    log.warn(
      "AIService",
      `parseSearchQuery failed: ${getErrorMessage(err)} — caller should run hybrid search without hard filters`,
    );
    return null;
  }
}

// =============================================================================
// 12. expandQueryForEmbedding (HyDE — Hypothetical Document Embeddings)
// =============================================================================

/**
 * Rewrite a natural-language query into a short hypothetical contact-shaped
 * paragraph for the *vector* retrieval channel. This is the HyDE technique
 * (Gao et al., 2022): instead of embedding the question, we embed an
 * imagined answer. The hypothetical doc lives in the same semantic space
 * as real contact profiles, so cosine similarity finds them more reliably
 * than a bare question would.
 *
 * Example:
 *   "Who lives in America?"
 *   → "This person is based in the United States. They live in a US city
 *      like San Francisco, New York, Boston, or Austin. Their profile
 *      mentions an American state or US-based company."
 *
 * The returned string is meant to be fed to `embedText()` in place of the
 * raw query — the FTS5 channel still uses the original query text.
 *
 * Cached by content-hashed query. Returns `null` on mock-mode or failure;
 * callers MUST fall through to embedding the raw query in that case.
 */
export async function expandQueryForEmbedding(
  query: string,
): Promise<string | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const cacheKey = contentHash(trimmed.toLowerCase());
  const cached = aiCache.get<string>("hyde", cacheKey);
  if (cached) {
    recordInvocation({
      operation: "hyde",
      latencyMs: 0,
      cached: true,
      description: `HyDE cache hit: "${trimmed.slice(0, 40)}"`,
    });
    return cached;
  }

  if (isMockMode()) return null;

  const systemPrompt = `You rewrite CRM search queries as short hypothetical contact profiles.

Given a question about a person, write 2-3 sentences describing someone who would match the query. Use vocabulary that would plausibly appear in a real contact's profile — geographic names, company names, industry terms, job titles, traits. Be concrete, not generic.

Output ONLY the profile text. No preamble, no quotes, no "Here is..." prefix.`;

  const prompt = `Query: "${trimmed}"

Hypothetical matching profile:`;

  try {
    const result = await provider.generate({
      systemPrompt,
      prompt,
      responseFormat: "text",
      routing: { prefer: "lite" },
      timeoutMs: 5_000,
    });

    const text = result.text?.trim();
    if (!text || text.length < 10 || text.length > 800) {
      log.debug(
        "AIService",
        `expandQueryForEmbedding rejected output (len=${text?.length ?? 0}) for "${trimmed.slice(0, 40)}"`,
      );
      return null;
    }

    aiCache.set("hyde", cacheKey, text);

    log.debug(
      "AIService",
      `HyDE "${trimmed.slice(0, 50)}" → "${text.slice(0, 80)}..." in ${result.latencyMs}ms via ${result.model}`,
    );
    recordInvocation({
      operation: "hyde",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `HyDE: "${trimmed.slice(0, 40)}"`,
    });
    return text;
  } catch (err: unknown) {
    log.warn(
      "AIService",
      `expandQueryForEmbedding failed: ${getErrorMessage(err)} — caller should embed raw query`,
    );
    return null;
  }
}
