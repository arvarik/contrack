// =============================================================================
// AI Services — Relationship Intelligence (briefings, email digests, insights)
// =============================================================================
// Extracted verbatim from aiService.ts in the domain split; the barrel there
// re-exports this module, so import sites are unchanged.
// =============================================================================

import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { recordInvocation } from "../../services/aiStatsService.ts";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "../promptSafety.ts";
import { generateFor } from "../gateway.ts";
import { isMockMode, safeParseJson } from "./shared.ts";

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

  const result = await generateFor("quick", {
    systemPrompt,
    prompt,
    responseFormat: "json",
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
    const result = await generateFor("deep", {
      systemPrompt,
      prompt,
      responseFormat: "text",
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
    const result = await generateFor("quick", {
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
