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
import type { McpToolContext } from "../../modules/module.ts";
import { mcpService } from "../../services/mcpService.ts";
import { listService } from "../../services/listService.ts";
import { AppError } from "../../utils/AppError.ts";
import { listRoutes } from "../../../shared/contracts/lists.ts";
import { answer, count } from "../tool.ts";
import { publicRecord } from "../views.ts";

export function registerTaxonomyTools({ tool, scope }: McpToolContext): void {
  tool("list_tags", {}, () => {
    const tags = mcpService.getTags(scope).map((r) => r.tag);
    return answer(
      `${count(tags.length, "tag")}: ${tags.slice(0, 10).join(", ")}${tags.length > 10 ? "…" : ""}`,
      { tags, total: tags.length },
    );
  });

  tool("list_lists", {}, () => {
    const lists = (listService.getAllLists(scope) as object[]).map((list) =>
      publicRecord(list),
    );
    return answer(count(lists.length, "list"), { lists, total: lists.length });
  });

  tool(
    "create_list",
    {
      // The REST route's rule for a list name.
      name: listRoutes.create.body.shape.name.describe(
        "The list's name, up to 60 characters",
      ),
    },
    ({ name }) => {
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
      return answer(
        `Created list "${list.name}" (${list.id})`,
        publicRecord(list),
      );
    },
  );

  tool(
    "add_to_list",
    {
      listId: z.string().min(1).describe("List ID to add contacts to"),
      // `POST /api/lists/:id/members/bulk` reads the same list of IDs.
      contactIds: listRoutes.addMembers.body.shape.contactIds.describe(
        "Array of contact IDs to add to the list",
      ),
    },
    ({ listId, contactIds }) => {
      const added = listService.bulkAddMembers(scope, listId, contactIds);
      // The count of rows written: a contact already in the list adds
      // nothing, and saying so keeps the client's picture right.
      return answer(`Added ${count(added, "contact")} to list ${listId}`, {
        listId,
        addedCount: added,
        requestedCount: contactIds.length,
      });
    },
  );

  tool(
    "remove_from_list",
    {
      listId: z.string().min(1).describe("List ID to remove contacts from"),
      contactIds: z
        .array(z.string().min(1))
        .min(1)
        .describe("Array of contact IDs to remove from the list"),
    },
    ({ listId, contactIds }) => {
      const removed = listService.bulkRemoveMembers(scope, listId, contactIds);
      return answer(
        `Removed ${count(removed, "contact")} from list ${listId}`,
        { listId, removedCount: removed, requestedCount: contactIds.length },
      );
    },
  );
}
