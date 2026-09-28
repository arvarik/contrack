/**
 * server/connectors/summaries.ts — AI summaries for connector-imported content.
 *
 * Calls the AI gateway with wrapUntrusted to summarize email and message bodies.
 * Invocations are recorded under the 'connectorSummary' operation and capped per run.
 *
 * A summary sends an email body to an AI provider, so it runs only when both
 * AI switches allow it: the instance switch an admin sets, and the connector
 * owner's own "Use AI for this account". The Privacy page promises that with
 * the account switch off, nothing goes to a provider for that person, and a
 * connector syncs in the background with nobody there to ask.
 *
 * @module server/connectors/summaries
 */

import { generateFor, isAnyProviderConfigured } from "../ai/gateway.ts";
import { aiAllowedForUser } from "../ai/instanceSwitch.ts";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "../ai/promptSafety.ts";
import { recordInvocation } from "../services/aiStatsService.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

export const MAX_SUMMARIES_PER_RUN = 50;

/**
 * True when a summary may go to a provider for this connector owner: a
 * provider is configured, and AI is on for the instance and for the owner.
 *
 * `accountId` is the owner's user id (SyncContext.accountId, which the sync
 * service sets to `scope.ownerId`). Every sync the service starts names its
 * owner. A call with no owner has no preference to check, so it is refused
 * rather than guessed.
 *
 * The adapters ask this before they download a message body that only a
 * summary needs, and `summarizeEmail` asks it again before it calls.
 */
export function summariesAllowed(accountId: string | undefined): boolean {
  return (
    !!accountId && isAnyProviderConfigured() && aiAllowedForUser(accountId)
  );
}

/**
 * Summarizes an email body using the 'quick' AI tier, for the connector
 * owner named by `accountId`.
 *
 * Returns the summary string, or null with no provider call when
 * `summariesAllowed` refuses (no provider, no owner, or AI off for the
 * instance or for the owner), or when an error occurs.
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

    return result.text.trim();
  } catch (err) {
    log.warn("Connectors", "Failed to generate email summary", {
      error: getErrorMessage(err),
    });
    return null;
  }
}
