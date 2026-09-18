/**
 * server/mcp/tools/actions.ts — Action items and follow-up MCP tools.
 *
 * Implements:
 * - list_action_items
 * - create_action_item
 * - complete_action_item
 *
 * @module server/mcp/tools/actions
 */

import { z } from "zod";
import { startOfDay, isBefore, isSameDay, isAfter, addDays } from "date-fns";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { actionItemService } from "../../services/actionItemService.ts";
import { NotFoundError } from "../../utils/AppError.ts";
import { MCP_TOOL_DESCRIPTIONS } from "../../../shared/mcpTools.ts";
import { trackedTool, type ErrorTracker } from "../errors.ts";

export function registerActionItemTools(
  server: McpServer,
  scope: Scope,
  onError: ErrorTracker,
): void {
  server.registerTool(
    "list_action_items",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_action_items,
      inputSchema: {
        due: z
          .enum(["overdue", "today", "week", "all"])
          .default("all")
          .optional()
          .describe("Urgency filter: overdue, today, week, or all"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async ({ due }) => {
      const allPending = actionItemService.getAllPending(scope) as Array<{
        id: string;
        contactId: string;
        title: string;
        dueAt: string | null;
        [key: string]: unknown;
      }>;
      const filter = due ?? "all";
      const today = startOfDay(new Date());
      const weekFromNow = addDays(today, 7);

      let filtered = allPending;
      if (filter === "overdue") {
        filtered = allPending.filter((item) => {
          if (!item.dueAt) return false;
          return isBefore(startOfDay(new Date(item.dueAt)), today);
        });
      } else if (filter === "today") {
        filtered = allPending.filter((item) => {
          if (!item.dueAt) return false;
          return isSameDay(startOfDay(new Date(item.dueAt)), today);
        });
      } else if (filter === "week") {
        filtered = allPending.filter((item) => {
          if (!item.dueAt) return false;
          return !isAfter(startOfDay(new Date(item.dueAt)), weekFromNow);
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `${filtered.length} pending action items (${filter})`,
          },
        ],
        structuredContent: {
          actionItems: filtered,
          total: filtered.length,
          filter,
        },
      };
    }),
  );

  server.registerTool(
    "create_action_item",
    {
      description: MCP_TOOL_DESCRIPTIONS.create_action_item,
      inputSchema: {
        contactId: z.string().min(1).describe("Contact ID"),
        title: z.string().min(1).describe("Title of the action item"),
        dueAt: z.string().min(1).describe("Due date/time in ISO 8601 format"),
      },
    },
    trackedTool(onError, async ({ contactId, title, dueAt }) => {
      const created = actionItemService.create(scope, contactId, title, dueAt);
      return {
        content: [
          {
            type: "text" as const,
            text: `Created action item "${created?.title ?? title}" due at ${dueAt}`,
          },
        ],
        structuredContent: (created ?? {}) as Record<string, unknown>,
      };
    }),
  );

  server.registerTool(
    "complete_action_item",
    {
      description: MCP_TOOL_DESCRIPTIONS.complete_action_item,
      inputSchema: {
        id: z.string().min(1).describe("Action item ID to complete"),
      },
      annotations: {
        idempotentHint: true,
      },
    },
    trackedTool(onError, async ({ id }) => {
      const completed = actionItemService.complete(scope, id);
      if (!completed) {
        throw new NotFoundError("ActionItem", id);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Marked action item ${id} as completed`,
          },
        ],
        structuredContent: completed as unknown as Record<string, unknown>,
      };
    }),
  );
}
