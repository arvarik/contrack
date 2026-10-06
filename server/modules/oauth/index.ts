// OAuth sign-in for MCP clients: the metadata and protocol routes outside /api,
// the consent page's calls under /api/auth/oauth, and the hourly sweep of what
// expired (server/services/oauthService.ts).

import { defineModule } from "../module.ts";
import { oauthConsentRouter, oauthRouter } from "../../routes/oauth.ts";
import { OAUTH_JOBS } from "../../jobs/oauth.ts";

export const oauthModule = defineModule({
  id: "oauth",
  routers: [
    { path: "/", router: oauthRouter },
    { path: "/api", router: oauthConsentRouter },
  ],
  jobs: OAUTH_JOBS,
});
