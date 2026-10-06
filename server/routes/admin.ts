// /api/admin: accounts, invitations and the audit log, mounted after the
// credential gate in server/app.ts. Every route carries `requireAdmin` itself,
// not through `router.use`, so a reader sees the guard beside the handler and
// the route manifest test fails on an admin route without it. Handlers are
// thin: the decisions, guards and audit rows live in adminService and
// invitationService.

import { Router, type Request } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { requireAdmin, requirePasswordCurrent } from "../middleware/auth.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { validateBody } from "../utils/validators.ts";
import {
  adminCreateUserSchema,
  adminSettingsSchema,
  adminIntegrationsSchema,
  adminDeleteUserSchema,
  adminInvitationSchema,
  adminUpdateUserSchema,
  adminMailSchema,
  auditQuerySchema,
} from "../../shared/contracts/admin.ts";
import {
  getLifecycleSettings,
  setTrashRetentionDays,
  setBackupIntervalHours,
  setBackupKeep,
  isTrashRetentionEnvSet,
  isBackupIntervalEnvSet,
  isBackupKeepEnvSet,
} from "../services/lifecycleSettings.ts";
import {
  getIntegrationsStatus,
  setGoogleOAuthCredentials,
  isGoogleOAuthEnvSet,
} from "../services/integrationSettings.ts";
import { SETTING_KEYS } from "../services/settingsService.ts";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  resetPassword,
  disableUser,
  enableUser,
  deleteUser,
  exportUserData,
  type AdminContext,
} from "../services/adminService.ts";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../services/invitationService.ts";
import { AUDIT_ACTIONS, auditService } from "../services/auditService.ts";
import { mailLinkOrigin, publicOrigin } from "../utils/publicOrigin.ts";
import { mailService } from "../services/mailService.ts";
import {
  renderPasswordResetEmail,
  renderTestEmail,
} from "../mail/templates.ts";
import { instanceHealth } from "../services/healthService.ts";
import {
  getInstanceName,
  setInstanceName,
  getSessionTtlDays,
  setSessionTtlDays,
  isRegistrationOpen,
  setRegistrationOpen,
  isMagicLinkSignIn,
  setMagicLinkSignIn,
  INSTANCE_NAME_MAX,
  MIN_SESSION_TTL_DAYS,
  MAX_SESSION_TTL_DAYS,
  DEFAULT_SESSION_TTL_DAYS,
} from "../services/authService.ts";
import {
  createAuthLink,
  discardAuthLink,
  ADMIN_RESET_LINK_TTL_SECONDS,
} from "../services/authLinkService.ts";
import { snapshotFile } from "../services/backupService.ts";

const router = Router();

/** Who is acting and from where. Read once per handler, like `scopeOf`. */
function adminContext(req: Request): AdminContext {
  // requireAdmin ran first, so there is a principal and it is an admin.
  return { actor: req.principal!.user, ip: req.ip ?? null };
}

// Health

/**
 * What an operator needs to know about this instance. Admin only, and not part
 * of `/healthz`, which anybody can reach and which must stay two states with no
 * detail, or it would tell anybody the version, the size and the number of
 * accounts. Read-only, so safe to poll, and nothing in it is secret.
 */
router.get(
  "/health",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(instanceHealth());
  }),
);

// Accounts

router.get(
  "/users",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ users: listUsers(adminContext(req)) });
  }),
);

router.post(
  "/users",
  requireAdmin,
  validateBody(adminCreateUserSchema),
  asyncHandler(async (req, res) => {
    const created = await createUser(adminContext(req), req.body);
    // The temporary password is in this response and nowhere else. It is not
    // logged, not audited, and cannot be read back.
    res.status(201).json(created);
  }),
);

router.get(
  "/users/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(getUser(adminContext(req), String(req.params.id)));
  }),
);

router.patch(
  "/users/:id",
  requireAdmin,
  validateBody(adminUpdateUserSchema),
  asyncHandler(async (req, res) => {
    const user = updateUser(adminContext(req), String(req.params.id), req.body);
    res.json({ user });
  }),
);

router.post(
  "/users/:id/reset-password",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await resetPassword(
      adminContext(req),
      String(req.params.id),
    );
    res.json(result);
  }),
);

router.post(
  "/users/:id/reset-link",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!mailService.isConfigured()) {
      throw new AppError("Outgoing mail is not configured", 409, {
        code: "MAIL_NOT_CONFIGURED",
      });
    }
    // The link goes to somebody else's inbox, so its address must not come
    // from this request's Host header. See mailLinkOrigin.
    const origin = mailLinkOrigin();
    if (!origin) {
      throw new AppError(
        "Set PUBLIC_URL on the server to send links by mail",
        409,
        { code: "PUBLIC_URL_REQUIRED" },
      );
    }
    const ctx = adminContext(req);
    const { user: target } = getUser(ctx, String(req.params.id));
    if (!target.email) {
      throw new AppError("User does not have an email address", 400);
    }
    const link = createAuthLink(
      "reset",
      target.id,
      ADMIN_RESET_LINK_TTL_SECONDS,
      ctx.actor.id,
      ctx.ip,
    );
    if (!link) {
      throw new AppError("Failed to create reset link", 500);
    }
    const resetUrl = `${origin}/reset-password?token=${link.token}`;
    const template = renderPasswordResetEmail({
      instanceName: getInstanceName(),
      link: resetUrl,
      expiresHours: 24,
    });
    try {
      await mailService.sendOrThrow({ to: target.email, ...template });
    } catch (err) {
      // A link nobody received must not stay redeemable, and the admin must
      // not read "Sent".
      discardAuthLink(link.id);
      throw new AppError(
        `Could not send the reset link: ${getErrorMessage(err)}`,
        502,
        { code: "MAIL_SEND_FAILED" },
      );
    }
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "user.password.reset",
      targetType: "user",
      targetId: target.id,
      details: { username: target.username, via: "email" },
      ip: ctx.ip,
    });
    res.json({ sentTo: target.email, expiresAt: link.expiresAt });
  }),
);

router.post(
  "/users/:id/disable",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ user: disableUser(adminContext(req), String(req.params.id)) });
  }),
);

router.post(
  "/users/:id/enable",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ user: enableUser(adminContext(req), String(req.params.id)) });
  }),
);

/**
 * One account's data as a download, for somebody who is leaving: the only
 * endpoint where an admin reads another account's contacts. It writes a
 * `user.exported` audit row naming the account.
 */
router.get(
  "/users/:id/export",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ctx = adminContext(req);
    const id = String(req.params.id);
    const { username, payload } = exportUserData(ctx, id);
    const stamp = payload.exportedAt.slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-export-${exportSlug(username)}-${stamp}.json"`,
    );
    log.info(
      "API",
      `[${req.requestId}] GET /api/admin/users/${id}/export → ${payload.contacts.length} contacts`,
    );
    res.send(JSON.stringify(payload, null, 2));
  }),
);

/**
 * One snapshot as a download, so an admin can keep a copy off the server.
 * Only a name the Backups list shows is served, and each download is in the
 * audit log, because a snapshot holds every account's contacts.
 */
router.get(
  "/backups/:filename",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ctx = adminContext(req);
    const filename = String(req.params.filename);
    const file = snapshotFile(filename);
    if (!file) {
      throw new AppError("That snapshot does not exist", 404, {
        code: "BACKUP_NOT_FOUND",
      });
    }
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "backup.downloaded",
      targetType: "backup",
      targetId: filename,
      ip: ctx.ip,
    });
    res.download(file, filename);
  }),
);

/**
 * The account name in a download filename. As in the self-service export, it
 * lands inside a quoted `Content-Disposition` header, where a stray quote would
 * end the filename.
 */
function exportSlug(username: string): string {
  const slug = username.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  return slug || "account";
}

router.delete(
  "/users/:id",
  requireAdmin,
  validateBody(adminDeleteUserSchema),
  asyncHandler(async (req, res) => {
    res.json(
      deleteUser(
        adminContext(req),
        String(req.params.id),
        req.body.decision as string | undefined,
      ),
    );
  }),
);

// Invitations

router.get(
  "/invitations",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ invitations: listInvitations() });
  }),
);

router.post(
  "/invitations",
  requireAdmin,
  validateBody(adminInvitationSchema),
  asyncHandler(async (req, res) => {
    // The link is in this response and nowhere else. The database holds only
    // the hash of the secret inside it.
    res
      .status(201)
      .json(
        await createInvitation(adminContext(req), req.body, publicOrigin(req)),
      );
  }),
);

router.delete(
  "/invitations/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(revokeInvitation(adminContext(req), String(req.params.id)));
  }),
);

// Instance settings

/** The one shape both routes answer with, so a write reads back as a read. */
function settingsView() {
  const lifecycle = getLifecycleSettings();
  return {
    registrationOpen: isRegistrationOpen(),
    sessionTtlDays: getSessionTtlDays(),
    sessionTtlRange: {
      min: MIN_SESSION_TTL_DAYS,
      max: MAX_SESSION_TTL_DAYS,
      default: DEFAULT_SESSION_TTL_DAYS,
    },
    instanceName: getInstanceName(),
    instanceNameMax: INSTANCE_NAME_MAX,
    mailConfigured: mailService.isConfigured(),
    // Mail set up and PUBLIC_URL set: what a link in a mail needs.
    mailLinksReady: mailService.canSendLinks(),
    magicLinkSignIn: isMagicLinkSignIn(),
    trashRetentionDays: lifecycle.trashRetentionDays.value,
    trashRetentionDaysSource: lifecycle.trashRetentionDays.source,
    backupIntervalHours: lifecycle.backupIntervalHours.value,
    backupIntervalHoursSource: lifecycle.backupIntervalHours.source,
    backupKeep: lifecycle.backupKeep.value,
    backupKeepSource: lifecycle.backupKeep.source,
  };
}

router.get(
  "/settings",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(settingsView());
  }),
);

/**
 * Change one or both instance settings, the session lifetime among them. The
 * audit row names the keys that changed, not their values, as the AI settings
 * rows do: a value is what occasionally turns out to be secret.
 */
router.put(
  "/settings",
  requireAdmin,
  validateBody(adminSettingsSchema),
  asyncHandler(async (req, res) => {
    // Validate all environment overrides and preconditions upfront before applying any writes
    if (req.body.magicLinkSignIn && !mailService.isConfigured()) {
      throw new AppError(
        "Outgoing mail must be configured before enabling magic links",
        409,
        { code: "MAIL_NOT_CONFIGURED" },
      );
    }
    if (req.body.trashRetentionDays !== undefined && isTrashRetentionEnvSet()) {
      throw new AppError(
        "Trash retention is set by environment variable TRASH_RETENTION_DAYS",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }
    if (
      req.body.backupIntervalHours !== undefined &&
      isBackupIntervalEnvSet()
    ) {
      throw new AppError(
        "Backup interval is set by environment variable BACKUP_INTERVAL_HOURS",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }
    if (req.body.backupKeep !== undefined && isBackupKeepEnvSet()) {
      throw new AppError(
        "Backup keep count is set by environment variable BACKUP_KEEP",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }

    const changed: string[] = [];
    if (req.body.registrationOpen !== undefined) {
      setRegistrationOpen(req.body.registrationOpen);
      changed.push("auth.registrationOpen");
    }
    if (req.body.sessionTtlDays !== undefined) {
      setSessionTtlDays(req.body.sessionTtlDays);
      changed.push("auth.sessionTtlDays");
    }
    if (req.body.instanceName !== undefined) {
      setInstanceName(req.body.instanceName);
      changed.push("instance.name");
    }
    if (req.body.magicLinkSignIn !== undefined) {
      setMagicLinkSignIn(req.body.magicLinkSignIn);
      changed.push("auth.magicLinkSignIn");
    }
    if (req.body.trashRetentionDays !== undefined) {
      setTrashRetentionDays(req.body.trashRetentionDays);
      changed.push(SETTING_KEYS.trashRetentionDays);
    }
    if (req.body.backupIntervalHours !== undefined) {
      setBackupIntervalHours(req.body.backupIntervalHours);
      changed.push(SETTING_KEYS.backupIntervalHours);
    }
    if (req.body.backupKeep !== undefined) {
      setBackupKeep(req.body.backupKeep);
      changed.push(SETTING_KEYS.backupKeep);
    }

    const ctx = adminContext(req);
    for (const key of changed) {
      auditService.record({
        actorUserId: ctx.actor.id,
        action: "settings.changed",
        targetType: "setting",
        targetId: key,
        ip: ctx.ip,
      });
    }
    res.json(settingsView());
  }),
);

// Integrations

router.get(
  "/integrations",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(getIntegrationsStatus());
  }),
);

router.put(
  "/integrations",
  requireAdmin,
  requirePasswordCurrent,
  validateBody(adminIntegrationsSchema),
  asyncHandler(async (req, res) => {
    const changed: string[] = [];

    if (req.body.googleOAuth !== undefined) {
      if (isGoogleOAuthEnvSet()) {
        throw new AppError(
          "Google OAuth credentials are set by environment variables GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
          409,
          { code: "SET_BY_ENVIRONMENT" },
        );
      }
      setGoogleOAuthCredentials(req.body.googleOAuth);
      changed.push("googleOAuth");
    }

    const ctx = adminContext(req);
    for (const key of changed) {
      auditService.record({
        actorUserId: ctx.actor.id,
        action: "integrations.changed",
        targetType: "integration",
        targetId: key,
        details: { key },
        ip: ctx.ip,
      });
    }

    res.json(getIntegrationsStatus());
  }),
);

// Outgoing mail

const mailTestLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 5,
  name: "mail test",
  keyBy: (req) => req.principal?.user.id ?? null,
});

export function __resetAdminRateLimits(): void {
  mailTestLimiter.reset();
}

/**
 * The mail settings, and the PUBLIC_URL links point at. Mail carries no
 * sign-in, reset or invitation link while that is null, and the page says so.
 */
function mailView(config: ReturnType<typeof mailService.resolveConfig>) {
  return { ...config, publicUrl: mailLinkOrigin() };
}

router.get(
  "/mail",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(mailView(mailService.resolveConfig()));
  }),
);

router.put(
  "/mail",
  requireAdmin,
  requirePasswordCurrent,
  validateBody(adminMailSchema),
  asyncHandler(async (req, res) => {
    const config = mailService.updateMailSettings(req.body);
    const ctx = adminContext(req);
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "mail.settings.changed",
      targetType: "mail",
      targetId: "smtp",
      ip: ctx.ip,
    });
    res.json(mailView(config));
  }),
);

router.delete(
  "/mail",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const config = mailService.deleteMailSettings();
    const ctx = adminContext(req);
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "mail.settings.changed",
      targetType: "mail",
      targetId: "smtp",
      details: { deleted: true },
      ip: ctx.ip,
    });
    res.json(mailView(config));
  }),
);

router.post(
  "/mail/test",
  requireAdmin,
  mailTestLimiter,
  asyncHandler(async (req, res) => {
    const ctx = adminContext(req);
    const recipient =
      (req.body as { to?: string } | undefined)?.to?.trim() || ctx.actor.email;
    if (!recipient) {
      throw new AppError("No email address configured for test recipient", 400);
    }
    const template = renderTestEmail({ instanceName: getInstanceName() });
    try {
      await mailService.sendOrThrow({
        to: recipient,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });
    } catch (err) {
      throw new AppError(getErrorMessage(err), 502, {
        code: "MAIL_SEND_FAILED",
      });
    }
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "mail.test.sent",
      targetType: "mail",
      targetId: "test",
      details: { to: recipient },
      ip: ctx.ip,
    });
    res.json({ sentTo: recipient });
  }),
);

// Audit log

router.get(
  "/audit",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("Invalid audit query", 400, {
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }
    // The filter is a list of exact actions from the vocabulary the app writes.
    // A free string matched with LIKE would answer a typo with an empty page,
    // which in an audit log reads as "nothing happened".
    let actions: string[] | undefined;
    if (parsed.data.action) {
      actions = parsed.data.action
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const unknown = actions.filter(
        (value) => !(AUDIT_ACTIONS as readonly string[]).includes(value),
      );
      if (unknown.length > 0) {
        throw new AppError(
          `Unknown audit action(s): ${unknown.join(", ")}`,
          400,
          { code: "VALIDATION_ERROR" },
        );
      }
    }

    res.json(auditService.list({ ...parsed.data, actions }));
  }),
);

export const adminRouter = router;
