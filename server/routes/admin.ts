// =============================================================================
// /api/admin — accounts, invitations, and the audit log
// =============================================================================
// Mounted at /api/admin in server/app.ts, after the credential gate. Every
// route carries `requireAdmin` on the route itself rather than through
// `router.use`, for two reasons: a reader sees the guard next to the handler
// it protects, and the route manifest test can find it in `route.stack` and
// fail if a new admin route ever arrives without it.
//
// Every handler is thin. The decisions, the guards and the audit rows live in
// adminService and invitationService.
// =============================================================================

import { Router, type Request } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { log } from "../utils/logger.ts";
import {
  validateBody,
  adminCreateUserSchema,
  adminSettingsSchema,
  adminDeleteUserSchema,
  adminInvitationSchema,
  adminUpdateUserSchema,
  auditQuerySchema,
} from "../utils/validators.ts";
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
import { instanceHealth } from "../services/healthService.ts";
import {
  getInstanceName,
  setInstanceName,
  getSessionTtlDays,
  setSessionTtlDays,
  isRegistrationOpen,
  setRegistrationOpen,
  INSTANCE_NAME_MAX,
  MIN_SESSION_TTL_DAYS,
  MAX_SESSION_TTL_DAYS,
  DEFAULT_SESSION_TTL_DAYS,
} from "../services/authService.ts";

const router = Router();

/** Who is acting and from where. Read once per handler, like `scopeOf`. */
function adminContext(req: Request): AdminContext {
  // requireAdmin ran first, so there is a principal and it is an admin.
  return { actor: req.principal!.user, ip: req.ip ?? null };
}

/**
 * The origin to build an invitation link from.
 *
 * Taken from the request so the link is right behind a reverse proxy without
 * the operator configuring a public URL anywhere. `req.protocol` reads
 * `X-Forwarded-Proto` because `trust proxy` is set in app.ts, and the host
 * comes from `X-Forwarded-Host` when a proxy sent one, because a proxy that
 * rewrites `Host` would otherwise put its own internal name in the link.
 *
 * `req.get("host")` is deliberately not `req.hostname`: the latter drops the
 * port, and a link to an instance on `:3210` needs it.
 *
 * The value is checked against a host shape rather than used as it arrives.
 * Only the one hop `trust proxy` names can set the header, but a value with a
 * slash or a space in it would put a path or a second field into the link,
 * and there is no reason to carry one.
 */
const HOST_SHAPE = /^[A-Za-z0-9.\-_[\]]+(?::\d{1,5})?$/;

function requestOrigin(req: Request): string {
  const forwarded = req.get("x-forwarded-host")?.split(",")[0].trim();
  const candidates = [forwarded, req.get("host")];
  const host = candidates.find((v) => v && HOST_SHAPE.test(v)) ?? "localhost";
  return `${req.protocol}://${host}`;
}

// ─── Health ──────────────────────────────────────────────────────────────────

/**
 * What an operator needs to know about this instance.
 *
 * Admin rather than public, and deliberately not part of `/healthz`. That
 * probe is reachable without a credential and must stay two states and no
 * detail: an unauthenticated endpoint that describes the instance tells
 * anybody who can reach the port what version it runs, how big it is, and how
 * many accounts it has.
 *
 * Nothing here is written, so it is safe to poll, and nothing here is a
 * secret. The most identifying value in the payload is a username beside a
 * queue position, and the caller can already list every account.
 */
router.get(
  "/health",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(instanceHealth());
  }),
);

// ─── Accounts ────────────────────────────────────────────────────────────────

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
 * One account's data as a download, for handing to somebody who is leaving.
 *
 * The only endpoint on which an admin reads another account's contacts. It
 * writes a `user.exported` audit row naming the account, so the read is
 * visible to everybody who can read the log.
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
 * The account name that goes in a download filename.
 *
 * Same rule as the self-service export: the value lands inside a quoted
 * `Content-Disposition` header, where a stray quote would end the filename.
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

// ─── Invitations ─────────────────────────────────────────────────────────────

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
      .json(createInvitation(adminContext(req), req.body, requestOrigin(req)));
  }),
);

router.delete(
  "/invitations/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(revokeInvitation(adminContext(req), String(req.params.id)));
  }),
);

// ─── Instance settings ───────────────────────────────────────────────────────

/** The one shape both routes answer with, so a write reads back as a read. */
function settingsView() {
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
 * Change one or both instance settings.
 *
 * This is where the session lifetime lives from 2.0 on.
 * `PUT /api/auth/session-policy` still writes the same value and is removed
 * in 3.0, which is why both exist and both are `admin`.
 *
 * The audit row names the keys that changed and not what they changed to for
 * the same reason the AI settings rows do: the key is what an operator needs
 * to see, and a value is the thing that occasionally turns out to be secret.
 */
router.put(
  "/settings",
  requireAdmin,
  validateBody(adminSettingsSchema),
  asyncHandler(async (req, res) => {
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

// ─── Audit log ───────────────────────────────────────────────────────────────

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
    // The filter is a list of exact actions, checked against the vocabulary
    // the app actually writes. A free string matched with LIKE would answer a
    // typo with an empty page, and an empty page in an audit log reads as
    // "nothing happened" — the one answer it must never give by accident.
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
