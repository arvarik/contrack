// Contracts: duplicates
// The duplicate routes under /api/dedupe that undo and redo a decision, and
// the one that says where a merged-away contact lives now. The scan, the
// suggestion list and the merge log have no contract yet (`UNCONTRACTED`).

import { z } from "zod";
import { route } from "./route.ts";
import { okSchema } from "./common.ts";

/** A record an undo could not put back as it was, and why. */
const mergeConflictSchema = z
  .strictObject({
    type: z.enum([
      "scalar_edited",
      "record_edited",
      "record_deleted",
      "task_completed",
    ]),
    /** The table the record is in, such as `contacts` or `action_items`. */
    entity: z.string(),
    id: z.string().optional(),
    field: z.string().optional(),
    primaryValue: z.unknown().optional(),
    duplicateValue: z.unknown().optional(),
    currentValue: z.unknown().optional(),
    oldValue: z.unknown().optional(),
    message: z.string(),
  })
  .meta({ id: "MergeConflict" });

const idParamsSchema = z.object({ id: z.string() });

export const dedupeRoutes = {
  undo: route({
    method: "POST",
    path: "/api/dedupe/merge-log/:id/undo",
    summary:
      "Undo a merge. By default the two contacts are also kept separate, so no scan or check merges them again",
    params: idParamsSchema,
    body: z
      .strictObject({
        /**
         * True, the default, records the two as different people. False puts
         * the pair back in the review, for an undo right after a slip.
         */
        keepSeparate: z.boolean().optional(),
      })
      .optional(),
    response: z.strictObject({
      success: z.literal(true),
      restoredContactId: z.string(),
      conflicts: z.array(mergeConflictSchema),
      keptSeparate: z.boolean(),
    }),
  }),
  restore: route({
    method: "POST",
    path: "/api/dedupe/suggestions/:id/restore",
    summary:
      "Put a pair that was kept separate back in the review, and let scans find it again",
    params: idParamsSchema,
    response: okSchema,
  }),
  mergedInto: route({
    method: "GET",
    path: "/api/dedupe/merged-into/:contactId",
    summary:
      "Where a merged-away contact lives now, or null while the contact is live",
    params: z.object({ contactId: z.string() }),
    response: z.strictObject({
      merge: z
        .strictObject({
          /** The merge that hid the contact, for Undo, or null. */
          mergeLogId: z.string().nullable(),
          /** The live contact at the end of its merge chain. */
          primaryId: z.string(),
          primaryName: z.string(),
          mergedBy: z.enum(["auto", "user"]),
          mergedAt: z.string(),
        })
        .nullable(),
    }),
  }),
};
