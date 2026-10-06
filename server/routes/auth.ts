// /api/auth: setup, sign-in, sign-out, profile, sessions.
//
// Mounted before the requireAuth gate in app.ts, so these stay reachable to
// someone who is not signed in. A handler that needs a credential asks for one
// itself (`requireSession`). On a gated instance with no accounts nobody can
// sign in, so /setup is open until an account exists, then answers 409.

import { Router, type Request, type Response } from "express";
import { AppError, ValidationError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validatePassword } from "../services/passwords.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import { validateBody } from "../utils/validators.ts";
import {
  acceptInvitationSchema,
  authRoutes,
  registerSchema,
} from "../../shared/contracts/auth.ts";
import { tokenRoutes } from "../../shared/contracts/tokens.ts";
import { auditService } from "../services/auditService.ts";
import {
  acceptInvitation,
  checkInvitation,
} from "../services/invitationService.ts";
import {
  createToken,
  listTokens,
  revokeToken,
} from "../services/apiTokenService.ts";
import {
  createRegistrationOptions,
  verifyRegistration,
  listPasskeys,
  renamePasskey,
  removePasskey,
  createLoginOptions,
  verifyLogin,
  isPasskeyNudgeDismissed,
  dismissPasskeyNudge,
} from "../services/passkeyService.ts";
import { getMapStyles } from "../utils/mapConfig.ts";
import {
  deletePreference,
  getPreferences,
  preferenceSchemas,
  preferencesPatchSchema,
  setPreferences,
  storedPreferenceKeys,
  type PreferenceKey,
} from "../services/userPreferencesService.ts";
import { mailService, type SendMailOptions } from "../services/mailService.ts";
import {
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
  accountIdForIdentifier,
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
  getInstanceName,
  isRegistrationOpen,
  isMagicLinkSignIn,
  findUserByEmail,
  resetUserPasswordWithToken,
  getUserById,
  setUserAvatar,
  type User,
} from "../services/authService.ts";
import fs from "fs";
import multer from "multer";
import { resolveUploadPath } from "../utils/paths.ts";
import {
  processProfilePhoto,
  AVATAR_MIME_EXTENSIONS,
} from "../utils/avatarProcessor.ts";
import { mailLinkOrigin } from "../utils/publicOrigin.ts";
import { oauthIssuer } from "../services/oauthService.ts";
import type { SessionMethod } from "../../shared/devices.ts";
import {
  renderPasswordResetEmail,
  renderMagicLinkEmail,
} from "../mail/templates.ts";
import {
  createAuthLink,
  redeemAuthLink,
  RESET_LINK_TTL_SECONDS,
  MAGIC_LINK_TTL_SECONDS,
} from "../services/authLinkService.ts";

const router = Router();

const uploadAccountAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap for profile photos
  fileFilter: (_req, file, cb) => {
    if (file.mimetype in AVATAR_MIME_EXTENSIONS) return cb(null, true);
    cb(
      new ValidationError(
        "Only JPEG, PNG, GIF, WebP, or AVIF images are allowed",
      ),
    );
  },
});

/**
 * Brute-force protection on the credential endpoints: ten attempts a minute per
 * IP. A person fumbling a password never sees it, online guessing is hopeless,
 * and scrypt already caps a core at about ten guesses a second. Keyed by IP
 * alone, because keying by username lets an attacker lock a known account out
 * by failing on purpose.
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
 * Ten personal tokens an hour, per account rather than per address: a token is
 * the account's credential, and people behind one office address should not
 * share a budget. Far more than anybody needs, and too few for a runaway script
 * to fill the table.
 */
const tokenLimiter = createRateLimiter({
  windowMs: 3_600_000,
  max: 10,
  name: "token creation",
  keyBy: (req) => req.principal?.user.id ?? null,
});

/**
 * Three link requests per 15 minutes per IP, in front of
 * /api/auth/password-reset/request and /api/auth/magic-link/request.
 */
const linkLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 3,
  name: "auth links",
});

/** Clear every credential window in this module. Test seam. */
export function __resetAuthRateLimits(): void {
  credentialLimiter.reset();
  setupLimiter.reset();
  tokenLimiter.reset();
  linkLimiter.reset();
}

function bodyString(req: Request, field: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : "";
}

/** The client address to stamp on an audit row. */
function ipOf(req: Request): string | null {
  return req.ip ?? null;
}

/** The refusal a disabled account gets at sign-in. */
function accountDisabled(): AppError {
  return new AppError(
    "This account has been disabled. Ask an administrator to re-enable it.",
    403,
    { code: "ACCOUNT_DISABLED" },
  );
}

/**
 * Start a session for `user` and set its cookie. With `remember` false the
 * session lasts at most a day and the cookie ends with the browser.
 */
function startSession(
  req: Request,
  res: Response,
  user: User,
  method: SessionMethod,
  remember = true,
): void {
  const session = createSession(user.id, req.headers["user-agent"] ?? null, {
    method,
    remember,
  });
  setSessionCookie(req, res, session.secret, session.expiresAt, {
    sessionOnly: !remember,
  });
}

// Status

/**
 * What the client needs to choose a screen, in one round trip. `setupRequired`
 * is true only on a gated instance nobody can sign in to: an open instance must
 * not push anyone through setup. It counts accounts with a password, because
 * the local owner always exists.
 */
router.get("/status", (req, res) => {
  const authRequired = isAuthRequired();
  const user = currentUser(req);
  const passwordAccounts = countPasswordAccounts();
  const setupRequired = authRequired && passwordAccounts === 0;
  // How many contacts are here, for the setup screen only: "secure this
  // instance" reads differently when 431 contacts are about to belong to the
  // account being made.
  const deviceContacts = setupRequired ? countDeviceContacts() : 0;

  res.json({
    authRequired,
    authenticated: isAuthenticated(req),
    setupRequired,
    hasAccounts: passwordAccounts > 0,
    user: user ? publicUser(user) : null,
    deviceContacts,
    // Whether the sign-in screen should offer to create an account.
    registrationOpen: isRegistrationOpen(),
    // Whether mail can carry a reset or sign-in link, which also needs
    // PUBLIC_URL. The sign-in screen offers those only when it can.
    mailConfigured: mailService.canSendLinks(),
    magicLinkSignIn: isMagicLinkSignIn() && mailService.canSendLinks(),
    // True while this instance has never been secured, so its data belongs to
    // an account nobody can sign in to.
    localOwnerPresent: hasLocalOwner(),
    // The address people open (PUBLIC_URL), or null when it is not set. The
    // MCP settings page builds the address a client connects to from it, so
    // a client on another machine gets the public name, not localhost.
    publicUrl: mailLinkOrigin(),
    // Whether an MCP client can sign in with OAuth here (oauthService.ts):
    // sign-in is on, and PUBLIC_URL is https or a loopback http address.
    mcpOAuth: authRequired && oauthIssuer() !== null,
    // What this instance calls itself, or "". Unauthenticated on purpose: the
    // sign-in and join screens need it before anybody has a credential. An
    // operator who names an instance chooses to show the name to anybody who
    // can reach the port.
    instanceName: getInstanceName(),
    // The basemap style for each palette. Unauthenticated like the rest of
    // this payload: the URLs are public and the CSP header already names
    // their origins to anybody who loads a page.
    map: getMapStyles(),
  });
});

// First-run setup

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

    // Securing a used instance converts the local owner instead of adding an
    // account. The id stays, so every row it owns stays owned.
    const user = hasLocalOwner()
      ? await convertLocalOwner(input)
      : await createUser(input);

    // Sign the new account in immediately — making someone re-type the
    // password they just chose twice in a row is pure friction.
    startSession(req, res, user, "password");

    res.status(201).json({ user: publicUser(user) });
  }),
);

// Open registration

/**
 * Create an account without an invitation. Off by default, and only an admin
 * turns it on. The endpoint always exists, so a closed instance answers a clear
 * `403 REGISTRATION_CLOSED` rather than a 404. The account is always a member:
 * opening registration needs an admin, so this is never the first account.
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
    startSession(req, res, user, "password");
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

// Sign in and out

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
      // The audit row says whether the typed name matched an account, and
      // which, never the text: a password typed into the name field would stay
      // in the log. The actor is null, since nobody proved who they are.
      const matched = accountIdForIdentifier(identifier);
      auditService.record({
        actorUserId: null,
        action: "auth.login.failed",
        targetType: matched ? "user" : undefined,
        targetId: matched,
        details: { matched: matched !== null },
        ip: ipOf(req),
      });
      // One message for both "no such account" and "wrong password" — telling
      // them apart is how an attacker learns which usernames are real.
      throw new AppError("Incorrect username or password.", 401, {
        code: "INVALID_CREDENTIALS",
      });
    }

    // Checked after the password: telling somebody who has not proved ownership
    // that an account is disabled would reveal which usernames are real. The
    // right password earns a straight answer.
    if (user.status === "disabled") {
      auditService.record({
        actorUserId: user.id,
        action: "auth.login.failed",
        targetType: "user",
        targetId: user.id,
        details: { matched: true, reason: "disabled" },
        ip: ipOf(req),
      });
      throw accountDisabled();
    }

    startSession(req, res, user, "password", req.body?.remember !== false);
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

// Joining by invitation

/**
 * Turn an invitation link into an account, and sign it in. Here rather than in
 * routes/admin.ts because the person has no account yet: it sits in front of
 * the credential gate and shares the sign-in rate limiter.
 */
router.post(
  "/accept-invitation",
  credentialLimiter,
  validateBody(acceptInvitationSchema),
  asyncHandler(async (req, res) => {
    const user = await acceptInvitation(req.body, ipOf(req));
    startSession(req, res, user, "password");
    res.status(201).json({ user: publicUser(user) });
  }),
);

/**
 * Whether an invitation link can still make an account, asked when the link
 * opens, so a dead link says so before anybody fills in the form. Same answers
 * and rate limit as accepting it.
 */
router.post(
  "/invitations/check",
  credentialLimiter,
  validateBody(authRoutes.invitationCheck.body),
  asyncHandler(async (req, res) => {
    checkInvitation((req.body as { token: string }).token);
    res.json({ ok: true });
  }),
);

// Password reset and magic links

/**
 * The mail that carries a reset or sign-in link to an address, or null when
 * the address has no active account or its hourly cap is reached.
 */
function linkMail(
  kind: "reset" | "magic",
  email: string,
  origin: string,
  ip: string | null,
): { userId: string; mail: SendMailOptions } | null {
  const user = findUserByEmail(email);
  if (!user || user.status === "disabled") return null;
  const reset = kind === "reset";
  const link = createAuthLink(
    kind,
    user.id,
    reset ? RESET_LINK_TTL_SECONDS : MAGIC_LINK_TTL_SECONDS,
    null,
    ip,
  );
  if (!link) return null;
  const template = reset
    ? renderPasswordResetEmail({
        instanceName: getInstanceName(),
        link: `${origin}/reset-password?token=${link.token}`,
        expiresHours: 1,
      })
    : renderMagicLinkEmail({
        instanceName: getInstanceName(),
        link: `${origin}/signin-link?token=${link.token}`,
      });
  return { userId: user.id, mail: { to: user.email, ...template } };
}

/**
 * Answer 202, then send. An address with an account must answer as fast as
 * one without, or the time to answer tells which addresses have accounts.
 */
function answerThenSend(
  res: Response,
  outgoing: ReturnType<typeof linkMail>,
): void {
  res.status(202).json({});
  if (!outgoing) return;
  void mailService.send(outgoing.mail).then((sent) => {
    if (!sent) {
      log.warn(
        "Auth",
        `Failed to send a link email for account ${outgoing.userId}`,
      );
    }
  });
}

/**
 * Request a password reset link by email. Always 202, known address or not.
 * When mail can carry links (mail configured, PUBLIC_URL set) and the account
 * exists, it creates a 1-hour reset token (at most 3 an hour per account) and
 * sends it. The link's origin is PUBLIC_URL, never the request's host, which
 * the requester controls.
 */
router.post(
  "/password-reset/request",
  linkLimiter,
  asyncHandler(async (req, res) => {
    const email = bodyString(req, "email").trim().toLowerCase();
    const origin = mailLinkOrigin();
    if (email && mailService.isConfigured() && !origin) {
      log.warn(
        "Auth",
        "A password reset was requested, and no link was sent: set PUBLIC_URL so mail can carry links",
      );
    }
    answerThenSend(
      res,
      email && origin && mailService.isConfigured()
        ? linkMail("reset", email, origin, ipOf(req))
        : null,
    );
  }),
);

/**
 * Complete a password reset with a one-time token: redeem it, set the password,
 * clear mustChangePassword, revoke other sessions, sign in with method
 * "email-link", and audit it.
 */
router.post(
  "/password-reset/complete",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const token = bodyString(req, "token").trim();
    const password = bodyString(req, "password");
    if (!token) {
      throw new AppError("Reset token is required", 400);
    }
    if (!password) {
      throw new AppError("Password is required", 400);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new ValidationError(passwordError);
    }

    const link = redeemAuthLink("reset", token);
    const user = await resetUserPasswordWithToken(link.userId, password);
    startSession(req, res, user, "email-link");
    auditService.record({
      actorUserId: user.id,
      action: "auth.password.reset",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username },
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

/**
 * Request a magic link sign-in email. 404 MAGIC_LINK_OFF when the instance
 * switch is off or mail cannot carry links (no mail, or no PUBLIC_URL).
 * Otherwise always 202, so it cannot enumerate emails.
 */
router.post(
  "/magic-link/request",
  linkLimiter,
  asyncHandler(async (req, res) => {
    const origin = mailLinkOrigin();
    if (!isMagicLinkSignIn() || !origin || !mailService.isConfigured()) {
      throw new AppError("Magic link sign-in is disabled", 404, {
        code: "MAGIC_LINK_OFF",
      });
    }
    const email = bodyString(req, "email").trim().toLowerCase();
    answerThenSend(
      res,
      email ? linkMail("magic", email, origin, ipOf(req)) : null,
    );
  }),
);

/**
 * Complete a magic link sign-in with a one-time token (single use, 15 minute
 * TTL): sign in with method "email-link", set the cookie, and audit it.
 */
router.post(
  "/magic-link/complete",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const token = bodyString(req, "token").trim();
    if (!token) {
      throw new AppError("Sign-in token is required", 400);
    }

    const link = redeemAuthLink("magic", token);
    const user = getUserById(link.userId);
    if (!user || user.status === "disabled") {
      throw accountDisabled();
    }

    startSession(req, res, user, "email-link", req.body?.remember !== false);
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, method: "magic-link" },
      ip: ipOf(req),
    });
    auditService.record({
      actorUserId: user.id,
      action: "auth.magic_link.used",
      targetType: "user",
      targetId: user.id,
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

// The signed-in account

router.get("/me", requireSession, (req, res) => {
  // `via` is always "session" here, since only a session reaches this route. It
  // is part of the documented shape, so it is sent anyway.
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
  "/me/avatar",
  requireSession,
  uploadAccountAvatar.single("avatar"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("No image file provided");

    const user = currentUser(req)!;
    const avatarUrl = await processProfilePhoto(user.id, req.file.buffer);

    const latest = getUserById(user.id) ?? user;
    const previousUrl = latest.avatarUrl;

    let updated: User;
    try {
      updated = setUserAvatar(user.id, avatarUrl);
    } catch (err) {
      const newPath = resolveUploadPath(avatarUrl);
      if (newPath) {
        await fs.promises.unlink(newPath).catch(() => {});
      }
      throw err;
    }

    if (previousUrl && previousUrl !== avatarUrl) {
      const oldPath = resolveUploadPath(previousUrl);
      if (oldPath) {
        await fs.promises.unlink(oldPath).catch(() => {});
      }
    }

    res.json({ user: publicUser(updated) });
  }),
);

router.delete(
  "/me/avatar",
  requireSession,
  asyncHandler(async (req, res) => {
    const user = currentUser(req)!;
    const latest = getUserById(user.id) ?? user;
    const previousUrl = latest.avatarUrl;

    const updated = setUserAvatar(user.id, null);

    if (previousUrl) {
      const oldPath = resolveUploadPath(previousUrl);
      if (oldPath) {
        await fs.promises.unlink(oldPath).catch(() => {});
      }
    }

    res.json({ user: publicUser(updated) });
  }),
);

// Preferences: list density, the recent-contacts limit, dedupe sensitivity, the
// temperature unit, the theme and the search history. One GET and one PATCH,
// because they are read together and written one at a time.
//
// Not `requireSession`, which is why they are here and not beside /me. With
// sign-in off the caller is the local owner, whose principal is `implicit`, and
// a session gate would leave the default setup unable to choose a theme. A
// person's principal acts on that person's own account only.
//
// `stored` names the keys this account has chosen, so the browser can tell "the
// default, because nobody said" from "the default, because somebody chose it",
// which keeps the one-time move out of localStorage safe.

router.get("/preferences", (req, res) => {
  const user = currentUser(req);
  if (!user) {
    throw new AppError("Authentication required", 401, {
      code: "UNAUTHORIZED",
    });
  }
  res.json({
    preferences: getPreferences(user.id),
    stored: storedPreferenceKeys(user.id),
  });
});

router.patch(
  "/preferences",
  validateBody(preferencesPatchSchema),
  (req, res) => {
    const user = currentUser(req);
    if (!user) {
      throw new AppError("Authentication required", 401, {
        code: "UNAUTHORIZED",
      });
    }
    const preferences = setPreferences(user.id, req.body);
    log.info(
      "API",
      `[${req.requestId}] PATCH /api/auth/preferences → ${Object.keys(req.body).join(", ")}`,
    );
    res.json({ preferences, stored: storedPreferenceKeys(user.id) });
  },
);

router.delete("/preferences/:key", (req, res) => {
  const user = currentUser(req);
  if (!user) {
    throw new AppError("Authentication required", 401, {
      code: "UNAUTHORIZED",
    });
  }
  const { key } = req.params;
  if (!(key in preferenceSchemas)) {
    throw new AppError(`Unknown preference key: ${key}`, 404, {
      code: "NOT_FOUND",
    });
  }
  const preferences = deletePreference(user.id, key as PreferenceKey);
  log.info("API", `[${req.requestId}] DELETE /api/auth/preferences/${key}`);
  res.json({ preferences, stored: storedPreferenceKeys(user.id) });
});

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

// Sessions

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

// Personal API tokens. A token can reach none of these routes
// (`requireSession`), so a script cannot mint another token or revoke its own.

router.get("/tokens", requireSession, (req, res) => {
  res.json({ tokens: listTokens(currentUser(req)!.id) });
});

/**
 * Mint a token. The plaintext is in this response and nowhere else.
 * `requirePasswordCurrent` is here and not on the routes beside it: a new
 * long-lived credential from an account whose password two people know is the
 * risk, while listing and revoking are what a worried person needs.
 */
router.post(
  "/tokens",
  requireSession,
  requirePasswordCurrent,
  tokenLimiter,
  validateBody(tokenRoutes.create.body),
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

// Passkeys

router.post(
  "/passkeys/register/options",
  credentialLimiter,
  requireSession,
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    const result = await createRegistrationOptions(req, user);
    res.json(result);
  }),
);

router.post(
  "/passkeys/register/verify",
  credentialLimiter,
  requireSession,
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    const { ceremonyId, response, name } = req.body ?? {};
    const result = await verifyRegistration(
      req,
      user,
      ceremonyId,
      response,
      name,
    );
    res.status(201).json(result);
  }),
);

router.get(
  "/passkeys",
  requireSession,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    const passkeys = listPasskeys(user.id);
    const nudgeDismissed = isPasskeyNudgeDismissed(user.id);
    res.json({ passkeys, nudgeDismissed });
  }),
);

router.patch(
  "/passkeys/:id",
  requireSession,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    const name = bodyString(req, "name");
    const result = renamePasskey(req, user.id, String(req.params.id), name);
    res.json(result);
  }),
);

router.delete(
  "/passkeys/:id",
  requireSession,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    const result = removePasskey(req, user.id, String(req.params.id));
    res.json(result);
  }),
);

router.post(
  "/passkeys/login/options",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const result = await createLoginOptions(req);
    res.json(result);
  }),
);

router.post(
  "/passkeys/login/verify",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const { ceremonyId, response } = req.body ?? {};
    const { user } = await verifyLogin(req, ceremonyId, response);

    if (user.status === "disabled") {
      auditService.record({
        actorUserId: user.id,
        action: "auth.login.failed",
        targetType: "user",
        targetId: user.id,
        details: { identifier: user.username, reason: "disabled" },
        ip: ipOf(req),
      });
      throw accountDisabled();
    }

    startSession(req, res, user, "passkey", req.body?.remember !== false);
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, method: "passkey" },
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  "/passkey-nudge/dismiss",
  requireSession,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    dismissPasskeyNudge(user.id);
    res.json({ ok: true });
  }),
);

export const authRouter = router;
