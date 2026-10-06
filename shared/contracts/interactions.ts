// Contracts: a contact's timeline and its notes, attachments, the briefing,
// promoting a ghost, and the people a contact shares notes with. Also the
// note search's query, which `GET /api/interactions/search` (MCP) and
// `GET /api/search/interactions` (the app) both read.

import { z } from "zod";
import { route } from "./route.ts";
import {
  dateSchema,
  INTERNAL,
  isValidTimeZone,
  okSchema,
  pastDateSchema,
} from "./common.ts";
import { contactSchema } from "./contacts.ts";

// Request bodies and queries

/** Payload for POST /interactions. Type is open string. */
export const interactionCreateSchema = z.object({
  type: z.string().trim().min(1, "Type is required"),
  title: z.string().trim().min(1, "Title is required"),
  content: z.string().nullable().optional(),
  date: pastDateSchema.nullable().optional(),
  duration: z.number().nonnegative().max(525600).nullable().optional(),
  source: z.string().nullable().optional(),
  isViaId: z.string().nullable().optional(),
  isViaName: z.string().nullable().optional(),
  actionItem: z
    .object({
      title: z.string().trim().min(1, "Action item title is required"),
      dueAt: dateSchema,
    })
    .optional(),
});

/** Payload for PATCH /interactions/:id — only title and content are mutable. */
const interactionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    content: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

/** A calendar date, or an instant with its zone. */
const dayOrInstantSchema = z.union(
  [z.iso.date(), z.iso.datetime({ offset: true })],
  {
    error: "Use an ISO 8601 date, such as 2026-11-03 or 2026-11-03T15:00:00Z",
  },
);

/**
 * The query string of a note search. Every field is optional. `tz` is the
 * caller's IANA zone, so "last month" is the caller's month. `limit` and
 * `offset` are coerced from strings. A repeated key is refused.
 */
export const interactionSearchQuerySchema = z.object({
  q: z.string().max(500).optional(),
  from: dayOrInstantSchema.optional(),
  to: dayOrInstantSchema.optional(),
  type: z.string().trim().min(1).max(40).optional(),
  contactId: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(["relevance", "date"]).optional(),
  mode: z.enum(["auto", "all", "any"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
  tz: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, "Unknown time zone")
    .optional(),
});

const RELATIONSHIP_LIMIT_MESSAGE = "limit must be an integer from 1 to 200";

/** `limit`: whole digits from 1 to 200. Anything else is refused. */
const relationshipsQuerySchema = z.object({
  limit: z
    .string({ error: RELATIONSHIP_LIMIT_MESSAGE })
    .regex(/^\d+$/, RELATIONSHIP_LIMIT_MESSAGE)
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, RELATIONSHIP_LIMIT_MESSAGE)
        .max(200, RELATIONSHIP_LIMIT_MESSAGE),
    )
    .default(50)
    .describe("1 to 200, 50 when absent"),
});

// Answers

/** An `interactions` row. */
const interactionColumns = {
  id: z.string(),
  contactId: z.string(),
  /** Open: note, call, meeting, email, message and the importers' own. */
  type: z.string(),
  title: z.string(),
  /** Editor HTML or plain text. */
  content: z.string().nullable(),
  /** When it happened, not when it was written down. */
  date: z.string(),
  duration: z.string().nullable(),
  fileUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  fileType: z.string().nullable(),
  source: z.string().nullable(),
  /** JSON: the people the note names, each `{ contactId, name, isGhost }`. */
  mentions: z.string().nullable(),
  updatedAt: z.string(),
  ownerId: z.string().meta(INTERNAL),
};

const interactionSchema = z
  .strictObject(interactionColumns)
  .meta({ id: "Interaction" });

/**
 * One entry on a contact's timeline: the contact's own notes, and the notes
 * on other contacts that mention it, with the follow-ups each one made.
 */
const timelineEntrySchema = z
  .strictObject({
    ...interactionColumns,
    /** On a note that mentions this contact: the contact it was written on. */
    isViaName: z.string().nullable(),
    isViaId: z.string().nullable(),
    actionItems: z.array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        dueAt: z.string(),
        completedAt: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: "TimelineEntry" });

/** Start and end offsets of a matched term, in UTF-16 code units. */
const highlightRangeSchema = z.tuple([z.number().int(), z.number().int()]);

/** One note that answered a search: the person, the date, and the passage. */
export const interactionSearchHitSchema = z
  .strictObject({
    /** The interaction id. */
    id: z.string(),
    contactId: z.string(),
    type: z.string(),
    title: z.string(),
    /** The interaction date exactly as stored. */
    date: z.string(),
    /** The best passage of the body, or its opening when the title matched. */
    excerpt: z.string().nullable(),
    highlights: z.strictObject({
      title: z.array(highlightRangeSchema),
      excerpt: z.array(highlightRangeSchema),
    }),
    contact: z.strictObject({
      id: z.string(),
      name: z.string(),
      avatarUrl: z.string().nullable(),
      themeColor: z.string().nullable(),
      company: z.string().nullable(),
      role: z.string().nullable(),
    }),
  })
  .meta({ id: "InteractionSearchHit" });

/** An entry of the whole timeline, with the contact it was written on. */
export const globalTimelineEntrySchema = z.strictObject({
  ...interactionColumns,
  contactName: z.string(),
  contactAvatar: z.string().nullable(),
  contactThemeColor: z.string().nullable(),
});

// Routes

export const interactionRoutes = {
  timeline: route({
    method: "GET",
    path: "/api/contacts/:id/timeline",
    summary:
      "A contact's timeline, newest first: its notes and the notes that mention it",
    response: z.array(timelineEntrySchema),
  }),
  create: route({
    method: "POST",
    path: "/api/contacts/:id/interactions",
    summary:
      "Log an interaction. `actionItem` adds a follow-up in the same write",
    status: 201,
    body: interactionCreateSchema,
    response: interactionSchema,
  }),
  briefing: route({
    method: "POST",
    path: "/api/contacts/:id/briefing",
    summary: "A short AI briefing on a contact, from its notes",
    response: z.strictObject({ points: z.array(z.string()) }),
  }),
  promote: route({
    method: "POST",
    path: "/api/contacts/:id/promote",
    summary: "Make a ghost contact a full contact",
    response: contactSchema,
  }),
  attach: route({
    method: "POST",
    path: "/api/contacts/:id/attachments",
    summary:
      "Attach a file as the multipart field `attachment`, up to 50 MB. An .eml becomes an email interaction",
    status: 201,
    response: interactionSchema,
  }),
  update: route({
    method: "PATCH",
    path: "/api/interactions/:id",
    summary: "Change an interaction's title or content",
    body: interactionUpdateSchema,
    response: interactionSchema,
  }),
  delete: route({
    method: "DELETE",
    path: "/api/interactions/:id",
    summary: "Delete an interaction and its attachment",
    response: okSchema,
  }),
  relationships: route({
    method: "GET",
    path: "/api/contacts/:id/relationships",
    summary: "The contacts that share notes with this one, most shared first",
    query: relationshipsQuerySchema,
    response: z.array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
        company: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        themeColor: z.string().nullable(),
        role: z.string().nullable(),
        /** 1 for a ghost contact, as the row holds it. */
        isGhost: z.number().int().nullable(),
        sharedInteractions: z.number().int(),
      }),
    ),
  }),
};

export type Interaction = z.infer<typeof interactionSchema>;
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
export type InteractionSearchHit = z.infer<typeof interactionSearchHitSchema>;
