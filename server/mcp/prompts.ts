/**
 * server/mcp/prompts.ts — MCP Prompts for Contrack.
 *
 * Implements:
 * - catch_me_up(contactId): Briefing prompt with timeline inlined
 * - weekly_review(): Overdue, due this week, at-risk, and activity review
 *
 * @module server/mcp/prompts
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../tenancy/scope.ts";
import { contactService } from "../services/contactService.ts";
import { interactionService } from "../services/interactionService.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { NotFoundError } from "../utils/AppError.ts";
import { toMcpError } from "./errors.ts";

export function registerPrompts(server: McpServer, scope: Scope): void {
  server.prompt(
    "catch_me_up",
    "Prepare a briefing on a contact with their profile and recent timeline",
    {
      contactId: z.string().min(1).describe("The contact ID to review"),
    },
    async ({ contactId }) => {
      try {
        const contact = contactService.getContactById(scope, contactId);
        if (!contact) {
          throw new NotFoundError("Contact", contactId);
        }
        const timeline = interactionService.getTimeline(scope, contactId);

        return {
          description: `Catch me up on ${contact.name}`,
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text:
                  `Please catch me up on ${contact.name}` +
                  (contact.role || contact.company
                    ? ` (${contact.role ?? "No role"} at ${contact.company ?? "No company"})`
                    : "") +
                  `.\n\nContact Details:\n${JSON.stringify(contact, null, 2)}\n\n` +
                  `Recent Timeline (newest first):\n${JSON.stringify(timeline.slice(0, 20), null, 2)}\n\n` +
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

  server.prompt(
    "weekly_review",
    "Conduct a weekly CRM review of overdue follow-ups, items due this week, and at-risk relationships",
    async () => {
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
                  `Network Metrics:\n${JSON.stringify(pulse.metrics, null, 2)}\n\n` +
                  `Overdue Action Items:\n${JSON.stringify(pulse.overdue, null, 2)}\n\n` +
                  `Action Items Due Today:\n${JSON.stringify(pulse.dueToday, null, 2)}\n\n` +
                  `Action Items Due This Week:\n${JSON.stringify(pulse.upcoming, null, 2)}\n\n` +
                  `Relationships At Risk:\n${JSON.stringify(pulse.atRisk, null, 2)}\n\n` +
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
