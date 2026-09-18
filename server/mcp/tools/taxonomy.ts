/**
 * server/mcp/tools/taxonomy.ts — Tags and lists MCP tools.
 *
 * Implements:
 * - list_tags
 * - list_lists
 * - add_to_list
 *
 * @module server/mcp/tools/taxonomy
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { mcpService } from "../../services/mcpService.ts";
import { listService } from "../../services/listService.ts";
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
            text: `Added ${contactIds.length} contact(s) to list ${listId}`,
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
}
