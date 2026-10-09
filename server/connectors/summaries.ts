/**
 * AI summaries of connector-imported mail, through the gateway with
 * wrapUntrusted, recorded as 'connectorSummary' and capped per run. A summary
 * sends an email body to a provider, so it runs only when the instance switch
 * and the owner's own "Use AI for my account" both allow it: a connector syncs
 * in the background, with nobody there to ask.
 *
 * @module server/connectors/summaries
 */

import { generateFor, isAnyProviderConfigured } from "../ai/gateway.ts";
import { aiAllowedForUser } from "../ai/instanceSwitch.ts";
import {
  sanitizeAiOutputValue,
  wrapUntrusted,
  UNTRUSTED_DATA_RULE,
} from "../ai/promptSafety.ts";
import { recordInvocation } from "../services/aiStatsService.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

export const MAX_SUMMARIES_PER_RUN = 50;

/**
 * True when a summary may go to a provider for this connector owner: a provider
 * is configured and AI is on for the instance and the owner. `accountId` is the
 * owner's user id (SyncContext.accountId, `scope.ownerId`); a call with no
 * owner has no preference to check, so it is refused. The adapters ask this
 * before downloading a body only a summary needs, and `summarizeEmail` asks
 * again before it calls.
 */
export function summariesAllowed(accountId: string | undefined): boolean {
  return (
    !!accountId && isAnyProviderConfigured() && aiAllowedForUser(accountId)
  );
}

/**
 * Summarize an email body with the 'quick' capability, for the owner named by
 * `accountId`. Null, with no provider call, when `summariesAllowed` refuses,
 * and on an error.
 */
export async function summarizeEmail(
  subject: string,
  bodyText: string,
  options?: { signal?: AbortSignal; accountId?: string },
): Promise<string | null> {
  const accountId = options?.accountId;
  if (!summariesAllowed(accountId)) {
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

  // The sender writes the subject as well as the body, so both are fenced.
  const prompt = `Please summarize the following email.

${wrapUntrusted("email_subject", subject || "(No subject)", 300)}

${wrapUntrusted("email_body", trimmedBody, 8_000)}`;

  try {
    const result = await generateFor("quick", {
      systemPrompt,
      prompt,
      responseFormat: "text",
      priority: "background",
      signal: options?.signal,
      accountId,
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

    // The summary is saved as a note, and an assistant reads notes through
    // MCP. An answer that echoes an injected instruction is dropped.
    return sanitizeAiOutputValue(result.text, 1_000);
  } catch (err) {
    log.warn("Connectors", "Failed to generate email summary", {
      error: getErrorMessage(err),
    });
    return null;
  }
}
