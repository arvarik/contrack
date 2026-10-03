// =============================================================================
// Module: data-lifecycle
// =============================================================================
// The trash, the exports and the database backups. Its jobs are the startup
// and scheduled snapshots and the daily trash purge. At start it says when
// the newest verified snapshot is too old, which is the only place an
// operator finds out that the backups they think they have stopped.
// =============================================================================

import { defineModule } from "../module.ts";
import { dataLifecycleRouter } from "../../routes/dataLifecycle.ts";
import { BACKUP_JOBS } from "../../jobs/backups.ts";
import { CONTACT_JOBS } from "../../jobs/contacts.ts";
import { startBackupSchedule } from "../../services/backupService.ts";

export const dataLifecycleModule = defineModule({
  id: "data-lifecycle",
  routers: [{ path: "/api", router: dataLifecycleRouter }],
  jobs: [...BACKUP_JOBS, ...CONTACT_JOBS],
  onStart: () => {
    startBackupSchedule();
  },
});
