// What an OIDC flow does once the provider has answered: link the account that
// started it, or find the account to sign in to and start its session. The
// route only turns the outcome into cookies and a redirect.
// - Sign-in reaches a linked identity, or an account whose verified email
//   matches, when the admin allows it and that account has no identity at this
//   provider yet, so an email never moves an existing link.
// - A sign-in's writes (the email link, lastUsedAt, the session, the audit
//   row) run in one transaction: a failure leaves no half-made sign-in.

import { sqlite } from "../db.ts";
import { AppError } from "../utils/AppError.ts";
import { auditService } from "./auditService.ts";
import {
  createSession,
  findUserByEmail,
  getUserById,
  type User,
} from "./authService.ts";
import {
  findUserIdByIdentity,
  linkIdentity,
  listIdentities,
  touchIdentity,
} from "./identityService.ts";
import { getOidcConfig } from "./integrationSettings.ts";
import type { OidcClaims } from "./oidcService.ts";

/** Who is asking, for the audit rows and the session. */
export interface OidcRequestInfo {
  ip: string | null;
  userAgent: string | null;
}

export type OidcLinkOutcome = "linked" | "taken" | "failed";

export type OidcSignInOutcome =
  | {
      outcome: "signed-in";
      user: User;
      session: { secret: string; expiresAt: string };
    }
  | { outcome: "no-account" | "disabled" };

/**
 * Link the provider identity to the account that started the flow. Only that
 * account, signed in with a session, may finish it.
 */
export function completeOidcLink(
  claims: OidcClaims,
  sessionUserId: string | null,
  info: OidcRequestInfo,
): OidcLinkOutcome {
  if (!claims.linkUserId || sessionUserId !== claims.linkUserId) {
    return "failed";
  }
  try {
    linkIdentity(sessionUserId, claims.issuer, claims.subject, claims.email);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) return "taken";
    throw err;
  }
  auditService.record({
    actorUserId: sessionUserId,
    action: "auth.oidc.linked",
    targetType: "user",
    targetId: sessionUserId,
    details: { issuer: claims.issuer },
    ip: info.ip,
  });
  return "linked";
}

/** The account a sign-in reaches, and whether the email match found it. */
function accountFor(
  claims: OidcClaims,
): { user: User; matchedByEmail: boolean } | null {
  const linkedId = findUserIdByIdentity(claims.issuer, claims.subject);
  if (linkedId) {
    const user = getUserById(linkedId);
    return user ? { user, matchedByEmail: false } : null;
  }
  if (!getOidcConfig()?.matchByEmail || !claims.emailVerified) return null;
  if (!claims.email) return null;
  const match = findUserByEmail(claims.email);
  if (!match) return null;
  const linkedHere = listIdentities(match.id).some(
    (identity) => identity.issuer === claims.issuer,
  );
  return linkedHere ? null : { user: match, matchedByEmail: true };
}

/** Find the account for a sign-in and start its session. */
export function completeOidcSignIn(
  claims: OidcClaims,
  info: OidcRequestInfo,
): OidcSignInOutcome {
  const found = accountFor(claims);
  if (!found) {
    auditService.record({
      actorUserId: null,
      action: "auth.login.failed",
      details: { method: "oidc", matched: false },
      ip: info.ip,
    });
    return { outcome: "no-account" };
  }
  const { user, matchedByEmail } = found;
  if (user.status === "disabled") {
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.failed",
      targetType: "user",
      targetId: user.id,
      details: { method: "oidc", reason: "disabled" },
      ip: info.ip,
    });
    return { outcome: "disabled" };
  }

  const session = sqlite.transaction(() => {
    if (matchedByEmail) {
      linkIdentity(user.id, claims.issuer, claims.subject, claims.email);
      auditService.record({
        actorUserId: user.id,
        action: "auth.oidc.linked",
        targetType: "user",
        targetId: user.id,
        details: { issuer: claims.issuer, matchedByEmail: true },
        ip: info.ip,
      });
    }
    touchIdentity(claims.issuer, claims.subject);
    const created = createSession(user.id, info.userAgent, { method: "oidc" });
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, method: "oidc" },
      ip: info.ip,
    });
    return created;
  })();
  return { outcome: "signed-in", user, session };
}
