// =============================================================================
// Contracts: action items
// =============================================================================
// Follow-ups: the account's queue, the recently done, the badge count, and
// one contact's own. A pending item's due date is what keeps the contact's
// `nextFollowUpAt`, through a trigger in the database.
// =============================================================================

import { z } from "zod";
import { route } from "./route.ts";
import { dateSchema, idsSchema, INTERNAL, okSchema } from "./common.ts";

// =============================================================================
// Request bodies
// =============================================================================

const actionItemCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  dueAt: dateSchema,
});

/** The most contacts one bulk follow-up may name. The map's dialog says so first. */
export const MAX_BULK_ACTION_ITEMS = 500;

const actionItemBulkCreateSchema = actionItemCreateSchema.extend({
  contactIds: idsSchema.refine(
    (ids) => ids.length <= MAX_BULK_ACTION_ITEMS,
    `At most ${MAX_BULK_ACTION_ITEMS} contacts at a time`,
  ),
});

const actionItemUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    dueAt: dateSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

// =============================================================================
// Answers
// =============================================================================

const actionItemColumns = {
  id: z.string(),
  contactId: z.string(),
  /** The interaction that made it, when one did. */
  interactionId: z.string().nullable(),
  title: z.string(),
  /** A calendar date or an ISO instant. */
  dueAt: z.string(),
  /** Null until it is done. */
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ownerId: z.string().meta(INTERNAL),
};

const actionItemSchema = z
  .strictObject(actionItemColumns)
  .meta({ id: "ActionItem" });

/** An item of the account's queue, with the contact it is for. */
const queuedActionItemSchema = z
  .strictObject({
    ...actionItemColumns,
    contactName: z.string(),
    contactCompany: z.string().nullable(),
    contactAvatarUrl: z.string().nullable(),
    contactThemeColor: z.string().nullable(),
  })
  .meta({ id: "QueuedActionItem" });

// =============================================================================
// Routes
// =============================================================================

export const actionItemRoutes = {
  pending: route({
    method: "GET",
    path: "/api/action-items",
    summary: "Every pending follow-up, soonest due first",
    response: z.array(queuedActionItemSchema),
  }),
  completed: route({
    method: "GET",
    path: "/api/action-items/completed",
    summary: "The 50 follow-ups done most recently",
    response: z.array(queuedActionItemSchema),
  }),
  count: route({
    method: "GET",
    path: "/api/action-items/count",
    summary: "How many pending follow-ups are due today or overdue",
    response: z.strictObject({ count: z.number().int() }),
  }),
  bulkCreate: route({
    method: "POST",
    path: "/api/action-items/bulk",
    summary:
      "Add the same follow-up to many contacts. One unknown id writes nothing",
    status: 201,
    body: actionItemBulkCreateSchema,
    response: z.strictObject({ count: z.number().int() }),
  }),
  update: route({
    method: "PATCH",
    path: "/api/action-items/:id",
    summary: "Change a follow-up's title or due date",
    body: actionItemUpdateSchema,
    response: actionItemSchema,
  }),
  complete: route({
    method: "PATCH",
    path: "/api/action-items/:id/complete",
    summary: "Mark a follow-up done. Done twice is still done",
    response: actionItemSchema,
  }),
  delete: route({
    method: "DELETE",
    path: "/api/action-items/:id",
    summary: "Delete a follow-up",
    response: okSchema,
  }),
  forContact: route({
    method: "GET",
    path: "/api/contacts/:id/action-items",
    summary: "A contact's follow-ups, pending first",
    response: z.array(actionItemSchema),
  }),
  create: route({
    method: "POST",
    path: "/api/contacts/:id/action-items",
    summary: "Add a follow-up to a contact",
    status: 201,
    body: actionItemCreateSchema,
    response: actionItemSchema,
  }),
};

export type ActionItem = z.infer<typeof actionItemSchema>;
export type QueuedActionItem = z.infer<typeof queuedActionItemSchema>;
