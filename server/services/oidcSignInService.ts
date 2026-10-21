// What an OIDC flow does once the provider has answered: link the account that
// started it, or find the account to sign in to and start its session. The
// route only checks the flow cookie and turns the result into a cookie and a
// redirect.
// - The callback consumes the flow first, then lands every outcome from it: a
//   link flow on Account settings, a sign-in on the sign-in page, or on the
//   path it started from when it succeeds.
// - Sign-in reaches a linked identity, or an account whose verified email
//   matches, when the admin allows it and that account has no identity at this
//   provider yet, so an email never moves an existing link.
// - A disabled account, or one that must change its password first, is
//   refused before anything is written.
// - A sign-in's writes (the email link, lastUsedAt, lastLoginAt, the session,
//   the audit row) run in one transaction: a failure leaves no half-made
//   sign-in.

import { ResponseBodyError } from "openid-client";
import { sqlite } from "../db.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
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
import {
  finishOidc,
  takeOidcFlow,
  type OidcClaims,
  type OidcFlow,
} from "./oidcService.ts";

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
  | { outcome: "no-account" | "disabled" | "must-change-password" };

/**
 * Link the provider identity to the account that started the flow. Only that
 * account, signed in with a session, may finish it.
 */
export function completeOidcLink(
  claims: OidcClaims,
  linkUserId: string,
  sessionUserId: string | null,
  info: OidcRequestInfo,
): OidcLinkOutcome {
  if (sessionUserId !== linkUserId) return "failed";
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
  remember: boolean,
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
  // A session would answer 403 everywhere until the password changes, and the
  // person may not know the temporary one.
  if (user.mustChangePassword === 1) {
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.failed",
      targetType: "user",
      targetId: user.id,
      details: { method: "oidc", reason: "must-change-password" },
      ip: info.ip,
    });
    return { outcome: "must-change-password" };
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
    sqlite
      .prepare("UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?")
      .run(user.id);
    const created = createSession(user.id, info.userAgent, {
      method: "oidc",
      remember,
    });
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

/** Where a flow lands: `outcome` names a failure, null is a success. */
function oidcLanding(flow: OidcFlow | null, outcome: string | null): string {
  if (flow?.userId) {
    return `/settings/account?oidc=${outcome ?? "linked"}#password`;
  }
  return outcome ? `/?oidc=${outcome}` : (flow?.returnTo ?? "/");
}

export interface OidcCallbackResult {
  /** Where the browser goes next. */
  landing: string;
  /** A sign-in's new session, for the cookie. */
  session?: { secret: string; expiresAt: string; remember: boolean };
}

/**
 * Finish the flow a callback names, from the URL the provider sent the
 * browser to. The caller has already checked the flow cookie. Never throws:
 * every failure is a landing.
 */
export async function finishOidcCallback(
  callbackUrl: URL,
  sessionUserId: string | null,
  info: OidcRequestInfo,
): Promise<OidcCallbackResult> {
  // Consumed first, so the landing knows a link flow from a sign-in, and the
  // state works once whatever happens next.
  const flow = takeOidcFlow(callbackUrl.searchParams.get("state") ?? "");
  const land = (outcome: string | null) => ({
    landing: oidcLanding(flow, outcome),
  });
  if (!flow) {
    log.warn("Auth", "OIDC callback for a flow that does not exist");
    return land("failed");
  }
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError !== null) {
    log.info("Auth", "OIDC provider returned an error", {
      error: providerError,
    });
    return land("denied");
  }
  if (flow.expired) return land("expired");

  let claims: OidcClaims;
  try {
    claims = await finishOidc(callbackUrl, flow);
  } catch (err) {
    // A refused token request carries the OAuth error, such as
    // invalid_client, which tells the operator why.
    log.warn("Auth", "OIDC sign-in did not finish", {
      error: err,
      ...(err instanceof ResponseBodyError && {
        oauthError: err.error,
        oauthErrorDescription: err.error_description,
      }),
    });
    return land("failed");
  }
  try {
    if (flow.userId) {
      const outcome = completeOidcLink(
        claims,
        flow.userId,
        sessionUserId,
        info,
      );
      return land(outcome === "linked" ? null : outcome);
    }
    const result = completeOidcSignIn(claims, flow.remember, info);
    if (result.outcome !== "signed-in") return land(result.outcome);
    return {
      ...land(null),
      session: { ...result.session, remember: flow.remember },
    };
  } catch (error) {
    log.warn("Auth", "OIDC sign-in failed after the provider answered", {
      error,
    });
    return land("failed");
  }
}
