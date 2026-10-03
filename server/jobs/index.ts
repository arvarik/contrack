// =============================================================================
// Every declared job, for the process that runs them
// =============================================================================
// One file per area declares its jobs. The server registers this list and
// starts the runner. Code that queues or runs a job imports the runner
// (./runner.ts), never this file, which imports every area.
//
// Recurring: connectors.tick (every minute, at start), scores.stale (hourly,
// at start), backup.scheduled (BACKUP_INTERVAL_HOURS), maintenance.daily and
// contacts.trashPurge and ai.modelCatalogs (daily, at start), scores.all and
// database.plannerStats (daily).
// At start, once: geocode.startup (2 s), connectors.photoSweep (5 s),
// backup.startup (15 s).
// On demand: dedupe.check, which the contact subscribers queue.
// =============================================================================

import type { JobDefinition } from "./runner.ts";
import { AI_JOBS } from "./ai.ts";
import { BACKUP_JOBS } from "./backups.ts";
import { CONNECTOR_JOBS } from "./connectors.ts";
import { CONTACT_JOBS } from "./contacts.ts";
import { DATABASE_JOBS } from "./database.ts";
import { DEDUPE_CHECK_JOB } from "./dedupe.ts";
import { GEOCODING_JOBS } from "./geocoding.ts";
import { MAINTENANCE_JOBS } from "./maintenance.ts";
import { SCORING_JOBS } from "./scoring.ts";

export const JOBS: readonly JobDefinition<unknown>[] = [
  ...CONNECTOR_JOBS,
  ...SCORING_JOBS,
  ...BACKUP_JOBS,
  ...MAINTENANCE_JOBS,
  ...CONTACT_JOBS,
  ...AI_JOBS,
  ...DATABASE_JOBS,
  ...GEOCODING_JOBS,
  DEDUPE_CHECK_JOB,
];
