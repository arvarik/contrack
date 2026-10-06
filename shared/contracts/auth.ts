// =============================================================================
// Contracts: sign-up
// =============================================================================
// The check of an invitation link, and the bodies of the two routes that
// create an account from outside. Those two have no contract yet: they are
// in `UNCONTRACTED` in `index.ts`. The token routes under /api/auth have
// theirs in `tokens.ts`.
// =============================================================================

import { z } from "zod";
import { route } from "./route.ts";

export const authRoutes = {
  invitationCheck: route({
    method: "POST",
    path: "/api/auth/invitations/check",
    summary:
      "Whether an invitation link can still make an account: 404 for one that never was, 410 for one used, revoked or expired",
    // Any string, like accepting the link: an empty token is one more
    // unknown link, not a field error.
    body: z.object({ token: z.string() }),
    response: z.strictObject({ ok: z.literal(true) }),
  }),
};

/** Body for POST /api/auth/accept-invitation.
 *
 *  `token` is any string, empty included, on purpose. Every string reaches
 *  the service and comes back as one 404, so an empty token, a token of the
 *  wrong shape and a token that simply is not in the table are three inputs
 *  with one answer. A `min(1)` here would answer an empty token with a 400
 *  that names the field, which is one bit more than a caller should learn. */
export const acceptInvitationSchema = z.object({
  token: z.string(),
  email: z.string().trim().min(1).max(254),
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(1024),
  displayName: z.string().max(200).nullable().optional(),
});

/** Body for POST /api/auth/register. The role is not a field: open
 *  registration always creates a member. */
export const registerSchema = z.object({
  email: z.string().trim().min(1).max(254),
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(1024),
  displayName: z.string().max(200).nullable().optional(),
});
