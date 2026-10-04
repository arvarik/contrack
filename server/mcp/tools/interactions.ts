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
import type { McpToolContext } from "../../modules/module.ts";
import { contactService } from "../../services/contactService.ts";
import { interactionService } from "../../services/interactionService.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { NotFoundError } from "../../utils/AppError.ts";
import { interactionRoutes } from "../../../shared/contracts/interactions.ts";
import { answer, count, cursorInput, pageOf } from "../tool.ts";
import { publicRecord } from "../views.ts";

// The REST body of the same write. A logged interaction is checked exactly as
// `POST /api/contacts/:id/interactions` checks one.
const logBody = interactionRoutes.create.body.shape;

export function registerInteractionTools({
  tool,
  scope,
}: McpToolContext): void {
  tool(
    "get_timeline",
    {
      contactId: z.string().min(1).describe("Contact ID"),
      cursor: cursorInput,
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .optional()
        .describe("Maximum entries to return (default 50, max 100)"),
    },
    ({ contactId, cursor, limit }) => {
      const contact = contactService.getContactById(scope, contactId);
      if (!contact) {
        throw new NotFoundError("Contact", contactId);
      }
      const all = interactionService.getTimeline(scope, contactId);
      const { page, nextCursor } = pageOf(all, cursor, limit ?? 50);
      return answer(
        `Timeline for ${contact.name}: ${count(page.length, "entry", "entries")} of ${all.length}`,
        {
          contactId,
          contactName: contact.name,
          timeline: page.map(publicRecord),
          total: all.length,
          nextCursor,
        },
      );
    },
  );

  tool(
    "log_interaction",
    {
      contactId: z
        .string()
        .min(1)
        .describe("ID of the contact this interaction is with"),
      type: logBody.type
        .default("note")
        .describe(
          "Interaction type (e.g. note, meeting, email, call, message)",
        ),
      title: logBody.title.describe("Summary title of the interaction"),
      content: logBody.content.describe(
        "Notes, discussion details, or email body",
      ),
      // The REST route's rule: an interaction has happened. A future date
      // would make the contact look caught up with until that day.
      date: logBody.date.describe(
        "When it happened, in ISO 8601: a day (2026-09-14) or a date and time. Not in the future. Defaults to now",
      ),
      mentionContactIds: z
        .array(z.string().min(1))
        .optional()
        .describe(
          "The IDs of the other contacts in it. Each one shows it on their timeline. When given, no AI reads the text for names",
        ),
    },
    (body) => {
      // Every ID must be a contact in the account, or nothing is logged. The
      // service drops an unknown ID quietly, as the note editor wants, and a
      // client should hear about a wrong ID instead.
      const mentionIds = [...new Set(body.mentionContactIds ?? [])].filter(
        (id) => id !== body.contactId,
      );
      const found = new Set(
        contactRepo
          .findManyOwned(scope, mentionIds)
          .filter((row) => row.deletedAt == null && row.canonicalId == null)
          .map((row) => row.id),
      );
      const missing = mentionIds.find((id) => !found.has(id));
      if (missing) throw new NotFoundError("Contact", missing);

      const created = interactionService.createInteraction(
        scope,
        body.contactId,
        {
          type: body.type || "note",
          title: body.title,
          content: body.content,
          // A null date is no date, as on the REST route: the note takes now.
          date: body.date ?? undefined,
          mentionContactIds: mentionIds.length ? mentionIds : undefined,
        },
      );
      return answer(
        `Logged "${created.title}" on contact ${body.contactId}`,
        publicRecord(created),
      );
    },
  );
}
