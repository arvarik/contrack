import { z } from "zod";
import { AppError } from "../../utils/AppError.ts";
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
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  if (isMockMode())
    throw new AppError("Configure AI in settings to generate a briefing.", 503);

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
    signal,
    timeoutMs: 20_000,
    maxOutputTokens: 1_000,
    jsonSchema: {
      type: "array",
      items: { type: "string" },
    },
  });

  signal?.throwIfAborted();
  const validated = z
    .array(z.string().trim().min(1).max(1500))
    .min(1)
    .max(5)
    .safeParse(
      safeParseJson<unknown>(result.text, "generateCatchMeUpBriefing"),
    );
  if (!validated.success)
    throw new AppError("AI returned an invalid briefing.", 502, {
      code: "AI_SCHEMA_MISMATCH",
    });
  const parsed = validated.data;

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
  if (isMockMode())
    throw new AppError("Configure AI in settings to summarize an email.", 503);

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
    if (
      !parsed ||
      typeof parsed.text !== "string" ||
      !parsed.text.trim() ||
      parsed.text.length > 2000 ||
      typeof parsed.category !== "string" ||
      parsed.category.length > 100
    )
      return null;

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
