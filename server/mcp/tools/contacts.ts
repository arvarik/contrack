/**
 * server/mcp/tools/contacts.ts — Contact management MCP tools.
 *
 * Implements:
 * - get_contact
 * - list_contacts
 * - create_contact
 * - update_contact
 *
 * @module server/mcp/tools/contacts
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { contactService } from "../../services/contactService.ts";
import { relationshipService } from "../../services/relationshipService.ts";
import { mcpService } from "../../services/mcpService.ts";
import { AppError, NotFoundError } from "../../utils/AppError.ts";
import { MCP_TOOL_DESCRIPTIONS } from "../../../shared/mcpTools.ts";
import { trackedTool, type ErrorTracker } from "../errors.ts";

export function registerContactTools(
  server: McpServer,
  scope: Scope,
  onError: ErrorTracker,
): void {
  server.registerTool(
    "get_contact",
    {
      description: MCP_TOOL_DESCRIPTIONS.get_contact,
      inputSchema: {
        id: z.string().min(1).describe("The contact ID to look up"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async ({ id }) => {
      const contact = contactService.getContactById(scope, id);
      if (!contact) {
        throw new NotFoundError("Contact", id);
      }
      const scoreExplanation = relationshipService.explainScore(id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Contact: ${contact.name} (${contact.role ?? "No role"} at ${contact.company ?? "No company"})`,
          },
        ],
        structuredContent: {
          contact,
          scoreExplanation,
        },
      };
    }),
  );

  server.registerTool(
    "list_contacts",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_contacts,
      inputSchema: {
        cursor: z
          .string()
          .optional()
          .describe("Pagination offset cursor as a string"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .optional()
          .describe("Maximum contacts to return (default 50, max 100)"),
        role: z.string().optional().describe("Filter contacts by role"),
        company: z.string().optional().describe("Filter contacts by company"),
        industry: z.string().optional().describe("Filter contacts by industry"),
        updatedSince: z
          .string()
          .optional()
          .describe("Filter contacts updated at or after this ISO timestamp"),
        tracked: z
          .boolean()
          .optional()
          .describe(
            "true for the people the account keeps up with, false for everyone else",
          ),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async (params) => {
      const limit = params.limit ?? 50;
      const offset = params.cursor ? parseInt(params.cursor, 10) || 0 : 0;
      const contacts = mcpService.queryContacts(scope, {
        limit,
        offset,
        role: params.role,
        company: params.company,
        industry: params.industry,
        updatedSince: params.updatedSince,
        tracked: params.tracked,
      });
      const nextCursor =
        contacts.length === limit ? String(offset + contacts.length) : null;
      return {
        content: [
          {
            type: "text" as const,
            text: `Retrieved ${contacts.length} contacts`,
          },
        ],
        structuredContent: {
          contacts,
          nextCursor,
        },
      };
    }),
  );

  server.registerTool(
    "create_contact",
    {
      description: MCP_TOOL_DESCRIPTIONS.create_contact,
      inputSchema: {
        name: z.string().min(1).describe("Full name of the contact"),
        headline: z.string().optional().describe("Professional headline"),
        role: z.string().optional().describe("Job title or role"),
        company: z.string().optional().describe("Company or organization"),
        location: z.string().optional().describe("Location or city"),
        about: z.string().optional().describe("Bio or background notes"),
        industry: z.string().optional().describe("Industry"),
        emails: z
          .array(
            z.object({
              email: z.string().email(),
              label: z.string().optional(),
              isPrimary: z.boolean().optional(),
            }),
          )
          .optional()
          .describe("Email addresses"),
        phones: z
          .array(
            z.object({
              phone: z.string(),
              label: z.string().optional(),
              isPrimary: z.boolean().optional(),
            }),
          )
          .optional()
          .describe("Phone numbers"),
        tags: z
          .array(z.object({ tag: z.string() }))
          .optional()
          .describe("Tags to attach"),
      },
      annotations: {
        idempotentHint: false,
      },
    },
    trackedTool(onError, async (body) => {
      const contact = contactService.createContact(scope, body);
      if (!contact) {
        throw new AppError("Failed to create contact", 500);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Created contact: ${contact.name} (${contact.id})`,
          },
        ],
        structuredContent: contact as unknown as Record<string, unknown>,
      };
    }),
  );

  server.registerTool(
    "update_contact",
    {
      description: MCP_TOOL_DESCRIPTIONS.update_contact,
      inputSchema: {
        id: z.string().min(1).describe("Contact ID to update"),
        fields: z
          .object({
            name: z.string().optional(),
            role: z.string().optional(),
            company: z.string().optional(),
            location: z.string().optional(),
            headline: z.string().optional(),
            about: z.string().optional(),
            industry: z.string().optional(),
            themeColor: z.string().optional(),
            isTracked: z
              .boolean()
              .optional()
              .describe("Keep up with this person (true) or stop (false)"),
            cadenceDays: z
              .number()
              .int()
              .positive()
              .optional()
              .describe(
                "How often to keep up, in days: 30, 60, 90, 180 or 365",
              ),
          })
          .describe("Fields to update on the contact"),
      },
    },
    trackedTool(onError, async ({ id, fields }) => {
      const updated = contactService.updateContact(scope, id, fields);
      if (!updated) {
        throw new NotFoundError("Contact", id);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated contact: ${updated.name} (${updated.id})`,
          },
        ],
        structuredContent: updated as unknown as Record<string, unknown>,
      };
    }),
  );
}
