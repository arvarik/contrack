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
import { auditService } from "../services/auditService.ts";

const router = Router();

/** Who is acting and from where. Read once per handler, like `scopeOf`. */
function adminContext(req: Request): AdminContext {
  // requireAdmin ran first, so there is a principal and it is an admin.
  return { actor: req.principal!.user, ip: req.ip ?? null };
}

/**
 * The origin to build an invitation link from.
 *
 * `req.protocol` honours `X-Forwarded-Proto` because `trust proxy` is set in
 * app.ts, and `req.get("host")` honours `X-Forwarded-Host` for the same
 * reason. So the link is right behind a reverse proxy without the operator
 * configuring a public URL anywhere.
 */
function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

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
    res.json(auditService.list(parsed.data));
  }),
);

export const adminRouter = router;
