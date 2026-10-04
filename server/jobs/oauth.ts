// =============================================================================
// Jobs: OAuth
// =============================================================================
// The sweep of expired sign-ins, expired tokens and clients nobody uses.
// =============================================================================

import { defineJob } from "./runner.ts";
import { sweepOAuth } from "../services/oauthService.ts";

const HOUR = 60 * 60 * 1000;

export const OAUTH_JOBS = [
  defineJob({
    kind: "oauth.sweep",
    every: HOUR,
    run() {
      sweepOAuth();
    },
  }),
];
