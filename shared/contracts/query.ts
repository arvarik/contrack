// Contracts: the read-only query routes
// The six REST routes in `server/routes/mcp.ts`, for an MCP client or a
// script with a personal token. They answer plain rows and arrays. The
// JSON-RPC transport at /api/mcp has no contract: the MCP SDK owns its
// protocol.

import { z } from "zod";
import { route } from "./route.ts";
import { queryInt, queryText } from "./common.ts";
import { contactRowSchema, contactSchema } from "./contacts.ts";
import {
  globalTimelineEntrySchema,
  interactionSearchHitSchema,
  interactionSearchQuerySchema,
} from "./interactions.ts";

export const queryRoutes = {
  contacts: route({
    method: "GET",
    path: "/api/query/contacts",
    summary:
      "Contacts as raw rows, newest first. Trashed, merged and ghost contacts are left out",
    query: z.object({
      // The cap holds for every value, a negative limit included, or it
      // would read every row.
      limit: queryInt(50, 1, 200).describe("1 to 200, 50 when absent"),
      offset: queryInt(0, 0, Number.MAX_SAFE_INTEGER).describe(
        "Rows to skip, 0 when absent",
      ),
      fields: queryText.describe(
        "The columns to keep, by name, separated by commas",
      ),
      role: queryText.describe("Contacts whose role contains this"),
      company: queryText.describe("Contacts whose company contains this"),
      industry: queryText.describe("Contacts in exactly this industry"),
    }),
    // `fields` keeps only the columns it names.
    response: z.array(contactRowSchema.partial()),
  }),
  dueContacts: route({
    method: "GET",
    path: "/api/contacts/action-items",
    summary:
      "The contacts due for contact: a follow-up date that has come, or a tracked contact past its cadence",
    response: z.array(contactSchema),
  }),
  tags: route({
    method: "GET",
    path: "/api/tags",
    summary: "Every tag the contacts hold, A to Z",
    response: z.array(z.string()),
  }),
  industries: route({
    method: "GET",
    path: "/api/industries",
    summary: "Every industry the contacts name, A to Z",
    response: z.array(z.string()),
  }),
  searchNotes: route({
    method: "GET",
    path: "/api/interactions/search",
    summary:
      "Search the notes. A date phrase in `q` is applied as a filter. Answers the hits alone",
    query: interactionSearchQuerySchema,
    response: z.array(
      interactionSearchHitSchema.extend({ contactName: z.string() }),
    ),
  }),
  timeline: route({
    method: "GET",
    path: "/api/timeline",
    summary: "The whole timeline, newest first",
    query: z.object({
      // The same cap as the query route, for the same reason.
      limit: queryInt(50, 1, 200).describe("1 to 200, 50 when absent"),
      since: queryText.describe("Entries on or after this date"),
      type: queryText.describe("Entries of exactly this type"),
    }),
    response: z.array(globalTimelineEntrySchema),
  }),
};
