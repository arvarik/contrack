/**
 * server/connectors/summaries.ts — AI summaries for connector-imported content.
 *
 * Calls the AI gateway with wrapUntrusted to summarize email and message bodies.
 * Invocations are recorded under the 'connectorSummary' operation and capped per run.
 *
 * @module server/connectors/summaries
 */

import { generateFor, isAnyProviderConfigured } from "../ai/gateway.ts";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "../ai/promptSafety.ts";
import { recordInvocation } from "../services/aiStatsService.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

export const MAX_SUMMARIES_PER_RUN = 50;

/**
 * Summarizes an email body using the 'quick' AI tier.
 * Returns the summary string, or null if no provider is configured or an error occurs.
 */
export async function summarizeEmail(
  subject: string,
  bodyText: string,
  options?: { signal?: AbortSignal; accountId?: string },
): Promise<string | null> {
  if (!isAnyProviderConfigured()) {
    return null;
  }

  const trimmedBody = bodyText?.trim();
  if (!trimmedBody) {
    return null;
  }

  const systemPrompt = `${UNTRUSTED_DATA_RULE}

You are an assistant summarizing an email for a personal CRM.
Provide a concise 1-2 sentence summary of the email content, focusing on key decisions, requests, or updates.
Respond with plain text only.`;

  const prompt = `Please summarize the following email.
Subject: ${subject || "(No subject)"}

${wrapUntrusted("email_body", trimmedBody, 8_000)}`;

  try {
    const result = await generateFor("quick", {
      systemPrompt,
      prompt,
      responseFormat: "text",
      priority: "background",
      signal: options?.signal,
      accountId: options?.accountId,
      maxOutputTokens: 200,
      timeoutMs: 15_000,
    });

    recordInvocation({
      operation: "connectorSummary",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `Email summary: ${(subject || "Untitled").slice(0, 50)}`,
    });

    return result.text.trim();
  } catch (err) {
    log.warn("Connectors", "Failed to generate email summary", {
      error: getErrorMessage(err),
    });
    return null;
  }
}
