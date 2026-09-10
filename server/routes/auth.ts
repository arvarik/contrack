// =============================================================================
// /api/auth — setup, sign-in, sign-out, profile, sessions
// =============================================================================
// Mounted BEFORE the requireAuth gate in app.ts, so these stay reachable to
// someone who is not signed in. Each handler that needs a credential asks for
// one itself via `requireUser`.
//
// The first-run problem: on a gated instance with no accounts, nobody can sign
// in, so /setup must be open. It closes itself the moment an account exists —
// `countUsers() > 0` makes it a 409 — which is how a self-hosted app avoids
// leaving an open registration endpoint on the internet.
// =============================================================================

import { Router, type Request } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import {
  validateBody,
  acceptInvitationSchema,
  registerSchema,
  tokenCreateSchema,
} from "../utils/validators.ts";
import { auditService } from "../services/auditService.ts";
import { acceptInvitation } from "../services/invitationService.ts";
import {
  createToken,
  listTokens,
  revokeToken,
} from "../services/apiTokenService.ts";
import { resolveApiToken } from "../middleware/auth.ts";
import {
  requireAdmin,
  requirePasswordCurrent,
  requireSession,
  isAuthRequired,
  isAuthenticated,
  currentUser,
  currentSessionId,
  presentedSessionSecret,
  setSessionCookie,
  clearSessionCookie,
} from "../middleware/auth.ts";
import {
  createUser,
  verifyCredentials,
  updateUser,
  changePassword,
  createSession,
  destroySession,
  listSessions,
  revokeOtherSessions,
  publicUser,
  countDeviceContacts,
  countPasswordAccounts,
  convertLocalOwner,
  hasLocalOwner,
  isRegistrationOpen,
  getSessionTtlDays,
  setSessionTtlDays,
  MIN_SESSION_TTL_DAYS,
  MAX_SESSION_TTL_DAYS,
  DEFAULT_SESSION_TTL_DAYS,
} from "../services/authService.ts";

const router = Router();

/**
 * Brute-force protection on the credential endpoints.
 *
 * Ten attempts a minute per IP. Generous enough that a person fumbling their
 * own password never sees it, tight enough that online guessing is hopeless
 * against any password worth the name — and it sits on top of scrypt, which
 * already caps a single core at roughly ten guesses a second.
 *
 * Keyed by IP alone rather than IP+username, deliberately: keying by username
 * lets an attacker lock a known account out by failing on purpose.
 */
const credentialLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  name: "sign-in",
});

/** Setup is slower still — it should be used exactly once. */
const setupLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  name: "account setup",
});

/**
 * Ten personal tokens an hour, per account rather than per address.
 *
 * Keyed by the account because a token is a credential that account owns, and
 * because several people behind one office address should not share a budget
 * for minting their own. Ten an hour is far more than anybody needs and low
 * enough that a runaway script cannot fill the table.
 */
const tokenLimiter = createRateLimiter({
  windowMs: 3_600_000,
  max: 10,
  name: "token creation",
  keyBy: (req) => req.principal?.user.id ?? null,
});

/** Clear every credential window in this module. Test seam. */
export function __resetAuthRateLimits(): void {
  credentialLimiter.reset();
  setupLimiter.reset();
  tokenLimiter.reset();
}

function bodyString(req: Request, field: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : "";
}

/** The client address to stamp on an audit row. */
function ipOf(req: Request): string | null {
  return req.ip ?? null;
}

// =============================================================================
// Status
// =============================================================================

/**
 * What the client needs to decide which screen to show, in one round trip.
 *
 * `setupRequired` is only true on a gated instance nobody can sign in to — an
 * un-gated instance has no reason to demand an account, so it must not push
 * anyone through a setup wizard they did not ask for.
 *
 * It counts accounts with a password, not accounts. Every instance now has the
 * local owner account from boot, so `countUsers() === 0` is never true and
 * would have hidden the setup screen from everyone.
 */
router.get("/status", (req, res) => {
  const authRequired = isAuthRequired();
  const user = currentUser(req);
  const passwordAccounts = countPasswordAccounts();
  const setupRequired = authRequired && passwordAccounts === 0;
  // How much data is sitting here. Only computed for the setup screen, which
  // is the one place it changes what someone should believe: "secure this
  // instance" reads very differently when you know 431 contacts are already
  // here and are about to belong to the account you are making.
  const deviceContacts = setupRequired ? countDeviceContacts() : 0;

  res.json({
    authRequired,
    authenticated: isAuthenticated(req),
    setupRequired,
    hasAccounts: passwordAccounts > 0,
    user: user ? publicUser(user) : null,
    deviceContacts,
    // The pre-2.0 name. It is removed in 3.0; sending both means the current
    // frontend keeps working until Phase 4 switches to the new one.
    existingContacts: deviceContacts,
    // Whether the sign-in screen should offer to create an account.
    registrationOpen: isRegistrationOpen(),
    // True while this instance has never been secured, so its data belongs to
    // an account nobody can sign in to.
    localOwnerPresent: hasLocalOwner(),
    // The deprecated instance-wide environment token. The admin UI shows a
    // banner asking the operator to replace it with a personal one.
    legacyTokenConfigured: resolveApiToken() !== null,
  });
});

// =============================================================================
// First-run setup
// =============================================================================

router.post(
  "/setup",
  setupLimiter,
  asyncHandler(async (req, res) => {
    if (countPasswordAccounts() > 0) {
      throw new AppError(
        "This instance already has an account. Sign in instead.",
        409,
        { code: "SETUP_COMPLETE" },
      );
    }

    const input = {
      email: bodyString(req, "email"),
      username: bodyString(req, "username"),
      password: bodyString(req, "password"),
      displayName: bodyString(req, "displayName"),
    };

    // Securing an instance that has been used converts the local owner rather
    // than creating a second account. The id does not change, so every row it
    // already owns stays owned, and nothing has to be claimed.
    const user = hasLocalOwner()
      ? await convertLocalOwner(input)
      : await createUser(input);

    // Sign the new account in immediately — making someone re-type the
    // password they just chose twice in a row is pure friction.
    const session = createSession(user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(req, res, session.secret, session.expiresAt);

    res.status(201).json({ user: publicUser(user) });
  }),
);

// =============================================================================
// Open registration
// =============================================================================

/**
 * Create an account without an invitation.
 *
 * Off by default and only an admin can turn it on. The endpoint exists at all
 * times so that the answer to a closed instance is a clear
 * `403 REGISTRATION_CLOSED` rather than a 404 that reads like a broken build.
 *
 * The account is always a member. `createUser` makes the first account on an
 * instance an admin, and that cannot happen here: turning registration on
 * needs an admin, so one already exists.
 */
router.post(
  "/register",
  credentialLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    if (!isRegistrationOpen()) {
      throw new AppError(
        "This instance is not open for registration. Ask an administrator for an invitation.",
        403,
        { code: "REGISTRATION_CLOSED" },
      );
    }

    const user = await createUser({ ...req.body, role: "member" });
    const session = createSession(user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(req, res, session.secret, session.expiresAt);
    auditService.record({
      actorUserId: user.id,
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, role: user.role, self: true },
      ip: ipOf(req),
    });
    res.status(201).json({ user: publicUser(user) });
  }),
);

// =============================================================================
// Sign in / out
// =============================================================================

router.post(
  "/login",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    if (!isAuthRequired()) {
      // Nothing to sign in to. Reported rather than faked, so the client can
      // stop showing a form that does not do anything.
      return res.json({ authRequired: false, user: null });
    }

    const identifier =
      bodyString(req, "identifier") ||
      bodyString(req, "username") ||
      bodyString(req, "email");
    const password = bodyString(req, "password");

    const user = await verifyCredentials(identifier, password);
    if (!user) {
      // The audit row records what was typed into the identifier field and
      // nothing else. A failed sign-in is the one event worth keeping for an
      // account that may not exist, which is why the actor is null.
      auditService.record({
        actorUserId: null,
        action: "auth.login.failed",
        details: { identifier: identifier.slice(0, 100) },
        ip: ipOf(req),
      });
      // One message for both "no such account" and "wrong password" — telling
      // them apart is how an attacker learns which usernames are real.
      throw new AppError("Incorrect username or password.", 401, {
        code: "INVALID_CREDENTIALS",
      });
    }

    // Checked after the password, not before. Saying "this account is
    // disabled" to someone who has not proved they own it would tell an
    // attacker which usernames are real, which is the thing the shared message
    // above exists to prevent. Someone holding the right password has already
    // earned a straight answer.
    if (user.status === "disabled") {
      auditService.record({
        actorUserId: user.id,
        action: "auth.login.failed",
        targetType: "user",
        targetId: user.id,
        details: { identifier: identifier.slice(0, 100), reason: "disabled" },
        ip: ipOf(req),
      });
      throw new AppError(
        "This account has been disabled. Ask an administrator to re-enable it.",
        403,
        { code: "ACCOUNT_DISABLED" },
      );
    }

    const session = createSession(user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(req, res, session.secret, session.expiresAt);
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username },
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.post("/logout", (req, res) => {
  const secret = presentedSessionSecret(req);
  const actor = currentUser(req);
  if (secret) destroySession(secret);
  clearSessionCookie(req, res);
  if (actor) {
    auditService.record({
      actorUserId: actor.id,
      action: "auth.logout",
      targetType: "user",
      targetId: actor.id,
      ip: ipOf(req),
    });
  }
  res.json({ success: true });
});

// =============================================================================
// Joining by invitation
// =============================================================================

/**
 * Turn an invitation link into an account, and sign it in.
 *
 * Lives in this file rather than in routes/admin.ts because the person using
 * it has no account yet: it must sit in front of the credential gate, and it
 * needs the same per-IP window the sign-in endpoints use, which is private to
 * this module.
 */
router.post(
  "/accept-invitation",
  credentialLimiter,
  validateBody(acceptInvitationSchema),
  asyncHandler(async (req, res) => {
    const user = await acceptInvitation(req.body, ipOf(req));
    const session = createSession(user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(req, res, session.secret, session.expiresAt);
    res.status(201).json({ user: publicUser(user) });
  }),
);

// =============================================================================
// The signed-in account
// =============================================================================

router.get("/me", requireSession, (req, res) => {
  // `via` says how this request proved who it is. Only a session reaches this
  // route, so the value is always "session" today, and it is sent because the
  // field is part of the documented shape and a later gate may widen it.
  res.json({
    user: publicUser(currentUser(req)!),
    via: req.principal?.via ?? "session",
  });
});

router.patch(
  "/me",
  requireSession,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = await updateUser(currentUser(req)!.id, {
      // Passed through only when present, so omitting a field leaves it alone
      // rather than clearing it.
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.username !== undefined ? { username: body.username } : {}),
      ...(body.displayName !== undefined
        ? { displayName: body.displayName }
        : {}),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  "/change-password",
  requireSession,
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const actor = currentUser(req)!;
    await changePassword(
      actor.id,
      bodyString(req, "currentPassword"),
      bodyString(req, "newPassword"),
      currentSessionId(req),
    );
    auditService.record({
      actorUserId: actor.id,
      action: "auth.password.changed",
      targetType: "user",
      targetId: actor.id,
      ip: ipOf(req),
    });
    res.json({ success: true });
  }),
);

// =============================================================================
// Sessions
// =============================================================================

router.get("/sessions", requireSession, (req, res) => {
  res.json({
    sessions: listSessions(currentUser(req)!.id, currentSessionId(req)),
  });
});

/** Sign out everywhere else, keeping the session making the request. */
router.delete("/sessions", requireSession, (req, res) => {
  const revoked = revokeOtherSessions(
    currentUser(req)!.id,
    currentSessionId(req),
  );
  res.json({ revoked });
});

// =============================================================================
// Personal API tokens
// =============================================================================
// A token acts as its account for every scoped endpoint and can reach none of
// these routes, so a script cannot mint a second token or revoke the one it
// is holding. `requireSession` is what says so.

router.get("/tokens", requireSession, (req, res) => {
  res.json({ tokens: listTokens(currentUser(req)!.id) });
});

/**
 * Mint a token. The plaintext is in this response and nowhere else.
 *
 * `requirePasswordCurrent` sits here and not on the two routes beside it. A
 * new long-lived credential minted from an account whose password two people
 * know is the risk; reading the list and revoking one are what somebody who
 * is worried needs, so those stay open.
 */
router.post(
  "/tokens",
  requireSession,
  requirePasswordCurrent,
  tokenLimiter,
  validateBody(tokenCreateSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(createToken(currentUser(req)!, req.body, ipOf(req)));
  }),
);

router.delete(
  "/tokens/:id",
  requireSession,
  asyncHandler(async (req, res) => {
    res.json(revokeToken(currentUser(req)!, String(req.params.id), ipOf(req)));
  }),
);

// =============================================================================
// Session policy
// =============================================================================

/**
 * How long new sessions last.
 *
 * Reading is open to any signed-in account. Writing is an instance setting, so
 * Phase 3 put `requireAdmin` in front of it, as the route manifest has said
 * since Phase 2. The endpoint is deprecated in favour of
 * `PUT /api/admin/settings` and stays for one release.
 */
router.get("/session-policy", requireSession, (_req, res) => {
  res.json({
    sessionTtlDays: getSessionTtlDays(),
    min: MIN_SESSION_TTL_DAYS,
    max: MAX_SESSION_TTL_DAYS,
    default: DEFAULT_SESSION_TTL_DAYS,
  });
});

router.put(
  "/session-policy",
  requireSession,
  requireAdmin,
  // This router is mounted ahead of the middleware copy of this guard, so
  // the one route in it that writes an instance setting carries the guard
  // itself. Without it an account still holding the password an admin chose
  // could set every future session on the instance to a year.
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionTtlDays = setSessionTtlDays(body.sessionTtlDays);
    auditService.record({
      actorUserId: currentUser(req)!.id,
      action: "settings.changed",
      targetType: "setting",
      targetId: "auth.sessionTtlDays",
      details: { sessionTtlDays },
      ip: ipOf(req),
    });
    res.json({ sessionTtlDays });
  }),
);

export const authRouter = router;
