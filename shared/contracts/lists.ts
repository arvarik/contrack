// =============================================================================
// Contracts: lists
// =============================================================================
// A person's own groups of contacts: the lists, their order, and who is in
// each. Mounted at /api/lists.
// =============================================================================

import { z } from "zod";
import { route } from "./route.ts";
import { idsSchema, INTERNAL, okSchema } from "./common.ts";
import { contactSchema } from "./contacts.ts";

// =============================================================================
// Request bodies
// =============================================================================

const listCreateSchema = z.object({
  name: z.string().trim().min(1, "List name is required").max(60),
  icon: z.string().optional(),
});

const listUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    icon: z.string().optional(),
  })
  .refine((d) => d.name !== undefined || d.icon !== undefined, {
    message: "At least one of name or icon is required",
  });

// =============================================================================
// Answers
// =============================================================================

const listSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    /** A Lucide icon name. */
    icon: z.string(),
    /** Lower comes first. */
    sortOrder: z.number().int(),
    createdAt: z.string(),
    ownerId: z.string().meta(INTERNAL),
    /** The members in the network: not trashed, merged or a ghost. */
    memberCount: z.number().int(),
  })
  .meta({ id: "List" });

// =============================================================================
// Routes
// =============================================================================

export const listRoutes = {
  all: route({
    method: "GET",
    path: "/api/lists",
    summary: "Every list, in the person's order",
    response: z.array(listSchema),
  }),
  create: route({
    method: "POST",
    path: "/api/lists",
    summary: "Make a list. Its icon is a star unless the body names one",
    status: 201,
    body: listCreateSchema,
    response: listSchema,
  }),
  reorder: route({
    method: "PUT",
    path: "/api/lists/reorder",
    summary: "Put the lists in a new order. Name each list exactly once",
    body: z.object({
      orderedIds: z.array(z.string().trim().min(1).max(200)).max(5000),
    }),
    response: okSchema,
  }),
  update: route({
    method: "PATCH",
    path: "/api/lists/:id",
    summary: "Rename a list or change its icon",
    body: listUpdateSchema,
    response: listSchema,
  }),
  contacts: route({
    method: "GET",
    path: "/api/lists/:id/contacts",
    summary: "The contacts in a list, newest first",
    response: z.array(contactSchema),
  }),
  delete: route({
    method: "DELETE",
    path: "/api/lists/:id",
    summary:
      "Delete a list. Its contacts stay. A list that is already gone answers the same",
    response: z.strictObject({
      success: z.literal(true),
      message: z.string(),
    }),
  }),
  addMember: route({
    method: "POST",
    path: "/api/lists/:id/members",
    summary: "Add a contact to a list",
    body: z.object({ contactId: z.string().trim().min(1).max(200) }),
    response: okSchema,
  }),
  removeMember: route({
    method: "DELETE",
    path: "/api/lists/:id/members/:contactId",
    summary: "Take a contact out of a list",
    response: okSchema,
  }),
  addMembers: route({
    method: "POST",
    path: "/api/lists/:id/members/bulk",
    summary: "Add many contacts to a list. `count` is how many were not in it",
    body: z.object({ contactIds: idsSchema }),
    response: z.strictObject({
      success: z.literal(true),
      count: z.number().int(),
    }),
  }),
};

export type ContactList = z.infer<typeof listSchema>;
