// Contracts: sign-up
// The check of an invitation link, and the bodies of the two routes that
// create an account from outside. Those two have no contract yet: they are
// in `UNCONTRACTED` in `index.ts`. The token routes under /api/auth have
// theirs in `tokens.ts`. Also the single sign-on (OIDC) routes and the email
// change.

import { z } from "zod";
import { queryText } from "./common.ts";
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
  oidcStart: route({
    method: "GET",
    path: "/api/auth/oidc/start",
    summary:
      "Start a single sign-on. Answers 302 to the provider, or to `/?oidc=failed` when it cannot start",
    query: z.object({
      remember: queryText.describe(
        '"0" for a session that ends when the browser closes',
      ),
      returnTo: queryText.describe(
        "A path on this site to land on after signing in. Anything else lands on `/`",
      ),
    }),
    status: 302,
    response: z.null(),
  }),
  oidcLink: route({
    method: "POST",
    path: "/api/auth/oidc/link",
    summary:
      "Start linking the signed-in account to the provider. Answers the provider's address. `401 INVALID_CREDENTIALS` when `currentPassword` is wrong",
    body: z.object({ currentPassword: z.string() }),
    response: z.strictObject({ url: z.string() }),
  }),
  oidcCallback: route({
    method: "GET",
    path: "/api/auth/oidc/callback",
    summary:
      "Where the provider sends the browser back. Answers 302: a sign-in to its `returnTo` (or `/`), a link to `/settings/account?oidc=linked#password`. A failure adds `?oidc=` with denied, expired, failed, no-account, disabled or must-change-password to `/`, or denied, expired, failed or taken to the Account settings address for a link",
    status: 302,
    response: z.null(),
  }),
  identities: route({
    method: "GET",
    path: "/api/auth/identities",
    summary: "The provider sign-ins linked to the account",
    response: z.strictObject({
      identities: z.array(
        z.strictObject({
          id: z.string(),
          issuer: z.string(),
          email: z.string().nullable(),
          createdAt: z.string(),
          lastUsedAt: z.string().nullable(),
          current: z
            .boolean()
            .describe("True when it is at the provider set up now"),
        }),
      ),
      matchByEmail: z
        .boolean()
        .describe(
          "True when email matching is on and this account's email is trusted, so a sign-in with that verified email can link it again",
        ),
    }),
  }),
  unlinkIdentity: route({
    method: "DELETE",
    path: "/api/auth/identities/:id",
    summary:
      "Unlink a provider sign-in from the account. `401 INVALID_CREDENTIALS` when `currentPassword` is wrong",
    body: z.object({ currentPassword: z.string() }),
    response: z.strictObject({ ok: z.literal(true) }),
  }),
  cancelEmailChange: route({
    method: "DELETE",
    path: "/api/auth/email-change",
    summary:
      "Stop the account's pending email change, so the link mailed to the new address no longer works",
    response: z.strictObject({ ok: z.literal(true) }),
  }),
  completeEmailChange: route({
    method: "POST",
    path: "/api/auth/email-change/complete",
    summary:
      "Finish an email change with the token mailed to the new address. The address becomes the account's and is trusted. It needs no session and signs nobody in. 404 LINK_INVALID, 410 LINK_USED or LINK_EXPIRED, 409 when another account took the address",
    body: z.object({ token: z.string() }),
    response: z.strictObject({ email: z.string() }),
  }),
};

/** Body for POST /api/auth/accept-invitation. `token` is any string, empty
 *  included, so every bad token gets the same 404. A `min(1)` would answer
 *  an empty one with a 400, which tells a caller more than it should. */
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
