// Connectors: calendar, mailbox, Google, messages, and their sync. Its jobs are
// the scheduler tick every minute and the stored photo sweep at start.

import { defineModule } from "../module.ts";
import { connectorsRouter } from "../../routes/connectors.ts";
import { CONNECTOR_JOBS } from "../../jobs/connectors.ts";

export const connectorsModule = defineModule({
  id: "connectors",
  routers: [{ path: "/api/connectors", router: connectorsRouter }],
  jobs: CONNECTOR_JOBS,
});
