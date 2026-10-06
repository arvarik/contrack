// The trash, the exports and the database backups. Its jobs are the startup and
// scheduled snapshots and the daily trash purge. At start it warns when the
// newest verified snapshot is too old, which is where an operator learns the
// backups stopped.

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
