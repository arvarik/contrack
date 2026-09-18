/**
 * server/mcp/tools/interactions.ts — Interaction and timeline MCP tools.
 *
 * Implements:
 * - get_timeline
 * - log_interaction
 *
 * @module server/mcp/tools/interactions
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { contactService } from "../../services/contactService.ts";
import { interactionService } from "../../services/interactionService.ts";
import { NotFoundError } from "../../utils/AppError.ts";
import { MCP_TOOL_DESCRIPTIONS } from "../../../shared/mcpTools.ts";
import { trackedTool, type ErrorTracker } from "../errors.ts";

export function registerInteractionTools(
  server: McpServer,
  scope: Scope,
  onError: ErrorTracker,
): void {
  server.registerTool(
    "get_timeline",
    {
      description: MCP_TOOL_DESCRIPTIONS.get_timeline,
      inputSchema: {
        contactId: z.string().min(1).describe("Contact ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .optional()
          .describe("Maximum entries to return (default 50, max 100)"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async ({ contactId, limit }) => {
      const contact = contactService.getContactById(scope, contactId);
      if (!contact) {
        throw new NotFoundError("Contact", contactId);
      }
      const rawTimeline = interactionService.getTimeline(scope, contactId);
      const timeline = rawTimeline.slice(0, limit ?? 50);

      return {
        content: [
          {
            type: "text" as const,
            text: `Timeline for ${contact.name}: ${timeline.length} entries`,
          },
        ],
        structuredContent: {
          contactId,
          contactName: contact.name,
          timeline,
        },
      };
    }),
  );

  server.registerTool(
    "log_interaction",
    {
      description: MCP_TOOL_DESCRIPTIONS.log_interaction,
      inputSchema: {
        contactId: z
          .string()
          .min(1)
          .describe("ID of the contact this interaction is with"),
        type: z
          .string()
          .default("note")
          .describe(
            "Interaction type (e.g. note, meeting, email, call, message)",
          ),
        title: z.string().min(1).describe("Summary title of the interaction"),
        content: z
          .string()
          .optional()
          .describe("Notes, discussion details, or email body"),
        date: z
          .string()
          .optional()
          .describe("Date/time in ISO 8601 format (defaults to now)"),
      },
    },
    trackedTool(onError, async (body) => {
      const created = interactionService.createInteraction(
        scope,
        body.contactId,
        {
          type: body.type || "note",
          title: body.title,
          content: body.content,
          date: body.date,
        },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Logged interaction "${created.title}" on contact ${body.contactId}`,
          },
        ],
        structuredContent: created,
      };
    }),
  );
}
