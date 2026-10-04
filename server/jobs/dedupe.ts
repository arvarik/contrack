// =============================================================================
// Jobs: the duplicate check for one contact
// =============================================================================
// Queued by the `contacts.dedupeCheck` subscriber (server/events/
// contactSubscribers.ts) five seconds after a contact is added or its
// identity fields change, keyed by the contact so a burst of edits is one
// check. It compares the contact against the rest of its owner's contacts.
// =============================================================================

import crypto from "node:crypto";
import { z } from "zod";
import { defineJob } from "./runner.ts";
import { dedupeService } from "../services/dedupe/index.ts";

export const DEDUPE_CHECK_JOB = defineJob<{ contactId: string }>({
  kind: "dedupe.check",
  payload: z.object({ contactId: z.string().min(1).max(200) }),
  async run({ contactId }) {
    await dedupeService.incrementalDedupeCheck(
      contactId,
      crypto.randomUUID().slice(0, 8),
    );
  },
});
