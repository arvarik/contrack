/**
 * server/mcp/tools/actions.ts — Action items and follow-up MCP tools.
 *
 * Implements:
 * - list_action_items
 * - create_action_item
 * - update_action_item
 * - complete_action_item
 *
 * @module server/mcp/tools/actions
 */

import { z } from "zod";
import { startOfDay, isBefore, isSameDay, isAfter, addDays } from "date-fns";
import type { McpToolContext } from "../../modules/module.ts";
import { actionItemService } from "../../services/actionItemService.ts";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../../utils/AppError.ts";
import { actionItemRoutes } from "../../../shared/contracts/actionItems.ts";
import { answer, count, cursorInput, pageOf } from "../tool.ts";
import { publicRecord } from "../views.ts";

// The REST bodies of the same writes. A tool's title and due date are checked
// exactly as the routes check them.
const createBody = actionItemRoutes.create.body.shape;
const updateBody = actionItemRoutes.update.body.shape;

type Due = "overdue" | "today" | "week" | "all";

/** Whether a follow-up due at `dueAt` falls in the urgency filter. */
function isDue(dueAt: string | null, due: Due, today: Date): boolean {
  if (due === "all") return true;
  if (!dueAt) return false;
  const day = startOfDay(new Date(dueAt));
  if (due === "overdue") return isBefore(day, today);
  if (due === "today") return isSameDay(day, today);
  return !isAfter(day, addDays(today, 7));
}

export function registerActionItemTools({ tool, scope }: McpToolContext): void {
  tool(
    "list_action_items",
    {
      due: z
        .enum(["overdue", "today", "week", "all"])
        .default("all")
        .optional()
        .describe("Urgency filter: overdue, today, week, or all"),
      cursor: cursorInput,
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .optional()
        .describe("Maximum follow-ups to return (default 50, max 100)"),
    },
    ({ due, cursor, limit }) => {
      const filter = due ?? "all";
      const today = startOfDay(new Date());
      const pending = (
        actionItemService.getAllPending(scope) as Array<{
          dueAt: string | null;
        }>
      ).filter((item) => isDue(item.dueAt, filter, today));
      const { page, nextCursor } = pageOf(pending, cursor, limit ?? 50);
      return answer(
        `${count(pending.length, "pending follow-up")} (${filter})`,
        {
          actionItems: page.map(publicRecord),
          total: pending.length,
          filter,
          nextCursor,
        },
      );
    },
  );

  tool(
    "create_action_item",
    {
      contactId: z.string().min(1).describe("Contact ID"),
      title: createBody.title.describe("Title of the action item"),
      // The REST route's rule. A value such as "next Friday" would be
      // saved, and then never count as overdue or due today.
      dueAt: createBody.dueAt.describe(
        "Due date in ISO 8601: a day (2026-11-03) or a date and time",
      ),
    },
    ({ contactId, title, dueAt }) => {
      // An unknown contact throws NOT_FOUND inside create.
      const created = actionItemService.create(scope, contactId, title, dueAt);
      if (!created) throw new AppError("The follow-up was not saved", 500);
      return answer(
        `Created follow-up "${created.title}" due ${dueAt}`,
        publicRecord(created),
      );
    },
  );

  tool(
    "update_action_item",
    {
      id: z.string().min(1).describe("Action item ID to change"),
      title: updateBody.title.describe("The new title"),
      dueAt: updateBody.dueAt.describe(
        "The new due date in ISO 8601: a day (2026-11-03) or a date and time",
      ),
    },
    ({ id, title, dueAt }) => {
      if (title === undefined && dueAt === undefined) {
        throw new ValidationError("Give a new title, a new dueAt, or both.");
      }
      const updated = actionItemService.update(scope, id, { title, dueAt });
      if (!updated) {
        throw new NotFoundError("ActionItem", id);
      }
      return answer(
        `Updated follow-up "${updated.title}", due ${updated.dueAt}`,
        publicRecord(updated),
      );
    },
  );

  tool(
    "complete_action_item",
    {
      id: z.string().min(1).describe("Action item ID to complete"),
    },
    ({ id }) => {
      const completed = actionItemService.complete(scope, id);
      if (!completed) {
        throw new NotFoundError("ActionItem", id);
      }
      return answer(
        `Marked follow-up ${id} as completed`,
        publicRecord(completed),
      );
    },
  );
}
