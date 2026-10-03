/**
 * server/mcp/tools/taxonomy.ts — Tags and lists MCP tools.
 *
 * Implements:
 * - list_tags
 * - list_lists
 * - create_list
 * - add_to_list
 * - remove_from_list
 *
 * @module server/mcp/tools/taxonomy
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { mcpService } from "../../services/mcpService.ts";
import { listService } from "../../services/listService.ts";
import { AppError } from "../../utils/AppError.ts";
import { MCP_TOOL_DESCRIPTIONS } from "../../../shared/mcpTools.ts";
import { trackedTool, type ErrorTracker } from "../errors.ts";

export function registerTaxonomyTools(
  server: McpServer,
  scope: Scope,
  onError: ErrorTracker,
): void {
  server.registerTool(
    "list_tags",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_tags,
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async () => {
      const rows = mcpService.getTags(scope);
      const tags = rows.map((r) => r.tag);
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${tags.length} tags: ${tags.slice(0, 10).join(", ")}${tags.length > 10 ? "..." : ""}`,
          },
        ],
        structuredContent: {
          tags,
          total: tags.length,
        },
      };
    }),
  );

  server.registerTool(
    "list_lists",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_lists,
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async () => {
      const lists = listService.getAllLists(scope);
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${lists.length} lists`,
          },
        ],
        structuredContent: {
          lists,
          total: lists.length,
        },
      };
    }),
  );

  server.registerTool(
    "create_list",
    {
      description: MCP_TOOL_DESCRIPTIONS.create_list,
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .describe("The list's name, up to 60 characters"),
      },
      annotations: {
        idempotentHint: false,
      },
    },
    trackedTool(onError, async ({ name }) => {
      // The app allows two lists with one name. A client that asks for a
      // list it already made would make a second one, so it is refused here.
      const taken = (
        listService.getAllLists(scope) as { id: string; name: string }[]
      ).find((list) => list.name.toLowerCase() === name.toLowerCase());
      if (taken) {
        throw new AppError(
          `A list named "${taken.name}" already exists (${taken.id}). Use add_to_list with that ID.`,
          409,
          { code: "DUPLICATE_LIST", details: { listId: taken.id } },
        );
      }
      const list = listService.createList(scope, name);
      return {
        content: [
          {
            type: "text" as const,
            text: `Created list "${list.name}" (${list.id})`,
          },
        ],
        structuredContent: list as unknown as Record<string, unknown>,
      };
    }),
  );

  server.registerTool(
    "add_to_list",
    {
      description: MCP_TOOL_DESCRIPTIONS.add_to_list,
      inputSchema: {
        listId: z.string().min(1).describe("List ID to add contacts to"),
        contactIds: z
          .array(z.string().min(1))
          .min(1)
          .describe("Array of contact IDs to add to the list"),
      },
      annotations: {
        idempotentHint: true,
      },
    },
    trackedTool(onError, async ({ listId, contactIds }) => {
      const added = listService.bulkAddMembers(scope, listId, contactIds);
      return {
        content: [
          {
            type: "text" as const,
            // The count of rows written: a contact already in the list adds
            // nothing, and saying so keeps the client's picture right.
            text: `Added ${added} contact(s) to list ${listId}`,
          },
        ],
        structuredContent: {
          success: true,
          listId,
          addedCount: added,
          requestedCount: contactIds.length,
        },
      };
    }),
  );

  server.registerTool(
    "remove_from_list",
    {
      description: MCP_TOOL_DESCRIPTIONS.remove_from_list,
      inputSchema: {
        listId: z.string().min(1).describe("List ID to remove contacts from"),
        contactIds: z
          .array(z.string().min(1))
          .min(1)
          .describe("Array of contact IDs to remove from the list"),
      },
      annotations: {
        idempotentHint: true,
      },
    },
    trackedTool(onError, async ({ listId, contactIds }) => {
      const removed = listService.bulkRemoveMembers(scope, listId, contactIds);
      return {
        content: [
          {
            type: "text" as const,
            text: `Removed ${removed} contact(s) from list ${listId}`,
          },
        ],
        structuredContent: {
          listId,
          removedCount: removed,
          requestedCount: contactIds.length,
        },
      };
    }),
  );
}
