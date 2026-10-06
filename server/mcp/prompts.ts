/**
 * server/mcp/prompts.ts — MCP Prompts for Contrack.
 *
 * Implements:
 * - catch_me_up(contact): Briefing prompt with timeline inlined. The
 *   argument is a name or a contact ID, and a client completes the name.
 * - weekly_review(): Overdue, due this week, at-risk, and activity review
 *
 * @module server/mcp/prompts
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { Scope } from "../tenancy/scope.ts";
import { contactService } from "../services/contactService.ts";
import { interactionService } from "../services/interactionService.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { mcpService } from "../services/mcpService.ts";
import { AppError, NotFoundError } from "../utils/AppError.ts";
import { toMcpError } from "./errors.ts";
import { contactProfile, lean } from "./views.ts";

/** A contact by ID, or by a name that only one contact holds. */
function findContact(scope: Scope, nameOrId: string) {
  const byId = contactService.getContactById(scope, nameOrId);
  if (byId) return byId;
  const found = mcpService.findByName(scope, nameOrId, 6);
  const wanted = nameOrId.trim().toLowerCase();
  const exact = found.filter((c) => c.name.toLowerCase() === wanted);
  const pick = exact.length === 1 ? exact : found;
  if (pick.length === 0) throw new NotFoundError("Contact", nameOrId);
  if (pick.length > 1) {
    const names = pick
      .slice(0, 5)
      .map((c) => `${c.name}${c.company ? `, ${c.company}` : ""} (ID ${c.id})`);
    throw new AppError(
      `More than one contact matches "${nameOrId}": ${names.join("; ")}. Give the contact ID.`,
      400,
      { code: "AMBIGUOUS_CONTACT" },
    );
  }
  return contactService.getContactById(scope, pick[0].id)!;
}

export function registerPrompts(server: McpServer, scope: Scope): void {
  server.registerPrompt(
    "catch_me_up",
    {
      title: "Catch me up",
      description:
        "Prepare a briefing on a contact with their profile and recent timeline",
      argsSchema: {
        contact: completable(
          z.string().min(1).describe("The contact's name or ID"),
          (value) =>
            mcpService.findByName(scope, value ?? "", 10).map((c) => c.name),
        ),
      },
    },
    ({ contact: nameOrId }) => {
      try {
        const contact = findContact(scope, nameOrId);
        const timeline = interactionService.getTimeline(scope, contact.id);
        const work = [contact.role, contact.company]
          .filter(Boolean)
          .join(" at ");

        return {
          description: `Catch me up on ${contact.name}`,
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text:
                  `Please catch me up on ${contact.name}${work ? ` (${work})` : ""}.\n\n` +
                  `Contact Details:\n${JSON.stringify(contactProfile(contact), null, 2)}\n\n` +
                  `Recent Timeline (newest first):\n${JSON.stringify(lean(timeline.slice(0, 20)), null, 2)}\n\n` +
                  `Please summarize who they are, our relationship history, recent key discussions, and recommended next steps.`,
              },
            },
          ],
        };
      } catch (err) {
        throw toMcpError(err);
      }
    },
  );

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly review",
      description:
        "Conduct a weekly CRM review of overdue follow-ups, items due this week, and the tracked contacts to catch up with",
    },
    () => {
      try {
        const pulse = dashboardService.getDashboardPayload(scope);

        return {
          description: "Weekly CRM and relationship review",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text:
                  `Please conduct a weekly review of my network using the following Pulse data:\n\n` +
                  `Network Metrics:\n${JSON.stringify(lean(pulse.metrics), null, 2)}\n\n` +
                  `Overdue follow-ups:\n${JSON.stringify(lean(pulse.overdue), null, 2)}\n\n` +
                  `Follow-ups due today:\n${JSON.stringify(lean(pulse.dueToday), null, 2)}\n\n` +
                  `Follow-ups due this week:\n${JSON.stringify(lean(pulse.upcoming), null, 2)}\n\n` +
                  `Tracked Contacts (count, bands, rising, cooling):\n${JSON.stringify(lean(pulse.tracking), null, 2)}\n\n` +
                  `Catch-ups (tracked contacts past their cadence):\n${JSON.stringify(lean(pulse.catchUp), null, 2)}\n\n` +
                  `Please provide a prioritized action list: who to reach out to first, which follow-ups need immediate attention, and recommended focus areas for this week.`,
              },
            },
          ],
        };
      } catch (err) {
        throw toMcpError(err);
      }
    },
  );
}
