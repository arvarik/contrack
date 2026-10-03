// =============================================================================
// Jobs: contacts
// =============================================================================
// The trash purge, at start and every day after: contacts in the trash past
// the retention window are deleted for good, each in its own owner's scope.
// =============================================================================

import { defineJob } from "./runner.ts";
import { contactService } from "../services/contactService.ts";

const DAY = 24 * 60 * 60 * 1000;

export const CONTACT_JOBS = [
  defineJob({
    kind: "contacts.trashPurge",
    every: DAY,
    atStart: true,
    run() {
      contactService.purgeExpiredTrash();
    },
  }),
];
