// Instance administration: accounts, invitations, settings, mail, the audit
// log, the health payload and the background jobs. Every route carries
// requireAdmin itself, so the manifest test sees the guard in each route's
// stack. Its jobs are the daily sweep of rows nothing else removes and the
// planner statistics.

import { defineModule } from "../module.ts";
import { adminRouter } from "../../routes/admin.ts";
import { jobsRouter } from "../../routes/jobs.ts";
import { MAINTENANCE_JOBS } from "../../jobs/maintenance.ts";
import { DATABASE_JOBS } from "../../jobs/database.ts";

export const adminModule = defineModule({
  id: "admin",
  routers: [
    { path: "/api/admin", router: adminRouter },
    { path: "/api/admin", router: jobsRouter },
  ],
  jobs: [...MAINTENANCE_JOBS, ...DATABASE_JOBS],
});
