// =============================================================================
// Contracts: tags
// =============================================================================
// The tag vocabulary of an account's contacts: the counts, a rename (which
// merges into a tag that already exists) and a delete everywhere. A contact's
// own tags are written through the contact.
// =============================================================================

import { z } from "zod";
import { route } from "./route.ts";

/** How many contacts a change touched. */
const affectedSchema = z.strictObject({ affected: z.number().int() });

const tagSummarySchema = z.strictObject({
  tag: z.string(),
  /** Contacts with the tag that are not archived and not in the Trash. */
  count: z.number().int(),
  /** Every contact with the tag, archived and trashed ones too. */
  total: z.number().int(),
});

export const tagRoutes = {
  summary: route({
    method: "GET",
    path: "/api/tags/summary",
    summary: "Every tag with the number of contacts that hold it",
    response: z.strictObject({ tags: z.array(tagSummarySchema) }),
  }),
  rename: route({
    method: "PATCH",
    path: "/api/tags/:tag",
    summary:
      "Rename a tag on every contact. Renaming onto a tag that exists merges the two",
    body: z.object({
      to: z.string().trim().min(1, "Tag name cannot be empty").max(100),
    }),
    response: affectedSchema,
  }),
  delete: route({
    method: "DELETE",
    path: "/api/tags/:tag",
    summary: "Remove a tag from every contact",
    response: affectedSchema,
  }),
};

export type TagSummary = z.infer<typeof tagSummarySchema>;
