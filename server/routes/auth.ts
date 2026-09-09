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

/** Clear both credential windows. Test seam — see RateLimiter.reset. */
export function __resetAuthRateLimits(): void {
  credentialLimiter.reset();
  setupLimiter.reset();
}

function bodyString(req: Request, field: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : "";
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
    // The pre-2.0 name. Phase 3 removes it; keeping both means the current
    // frontend keeps working through this phase without a matching release.
    existingContacts: deviceContacts,
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
      throw new AppError(
        "This account has been disabled. Ask an administrator to re-enable it.",
        403,
        { code: "ACCOUNT_DISABLED" },
      );
    }

    const session = createSession(user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(req, res, session.secret, session.expiresAt);
    res.json({ user: publicUser(user) });
  }),
);

router.post("/logout", (req, res) => {
  const secret = presentedSessionSecret(req);
  if (secret) destroySession(secret);
  clearSessionCookie(req, res);
  res.json({ success: true });
});

// =============================================================================
// The signed-in account
// =============================================================================

router.get("/me", requireSession, (req, res) => {
  res.json({ user: publicUser(currentUser(req)!) });
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
    await changePassword(
      currentUser(req)!.id,
      bodyString(req, "currentPassword"),
      bodyString(req, "newPassword"),
      currentSessionId(req),
    );
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
// Session policy
// =============================================================================

/**
 * How long new sessions last. Read is open to any authenticated caller;
 * writing needs a real account, since it is a security setting.
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
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionTtlDays = setSessionTtlDays(body.sessionTtlDays);
    res.json({ sessionTtlDays });
  }),
);

export const authRouter = router;
