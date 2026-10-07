// Contact jobs, three daily sweeps, at start and every day after:
// - the trash purge: trashed contacts past the retention window are deleted for
//   good, each in its own owner's scope;
// - the merge purge: a merged-away contact whose merge can no longer be undone
//   goes, with the merge log entries past the undo window;
// - the upload sweep: files under an account's folder that no row uses.

import { defineJob } from "./runner.ts";
import { contactService } from "../services/contactService.ts";
import { sweepOrphanUploads } from "../services/uploadCleanup.ts";

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
  defineJob({
    kind: "contacts.mergePurge",
    every: DAY,
    atStart: true,
    run() {
      contactService.purgeExpiredMerges();
    },
  }),
  defineJob({
    kind: "uploads.orphanSweep",
    every: DAY,
    // After the two purges above, which remove files of their own.
    atStart: 60_000,
    run() {
      sweepOrphanUploads();
    },
  }),
];
