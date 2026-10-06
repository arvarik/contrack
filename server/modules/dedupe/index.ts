// Duplicates: scans, suggestions, merges and undo. Its job is the duplicate
// check for one contact, which the contact subscribers queue.

import { defineModule } from "../module.ts";
import { dedupeRouter } from "../../routes/dedupe/index.ts";
import { DEDUPE_CHECK_JOB } from "../../jobs/dedupe.ts";

export const dedupeModule = defineModule({
  id: "dedupe",
  routers: [{ path: "/api", router: dedupeRouter }],
  jobs: [DEDUPE_CHECK_JOB],
});
