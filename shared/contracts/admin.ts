// =============================================================================
// Contracts: instance administration (request schemas only)
// =============================================================================
// The bodies and the query of the /api/admin routes. These routes have no
// contract yet: they are in `UNCONTRACTED` in `index.ts`, and the schemas
// wait here for one.
//
// Shape only. The semantic rules — is this username reserved, is this email
// already taken, is this password long enough — stay in authService, which is
// the one place that knows them and the one place the self-service paths use.
// =============================================================================

import { z } from "zod";

const roleSchema = z.enum(["admin", "member"]);

/** Body for POST /api/admin/users. `temporaryPassword` is optional: the
 *  server generates one when the admin does not supply it. */
export const adminCreateUserSchema = z.object({
  email: z.string().trim().min(1).max(254),
  username: z.string().trim().min(1).max(32),
  displayName: z.string().max(200).nullable().optional(),
  role: roleSchema.default("member"),
  temporaryPassword: z.string().min(1).max(1024).optional(),
});

/** Body for PATCH /api/admin/users/:id. Profile edits beyond the display name
 *  belong to the account holder, through PATCH /api/auth/me. */
export const adminUpdateUserSchema = z
  .object({
    role: roleSchema.optional(),
    displayName: z.string().max(200).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send a role or a display name to change",
  });

/** Body for DELETE /api/admin/users/:id. Without the decision the endpoint
 *  answers 409 with the counts and changes nothing.
 *
 *  A DELETE usually carries no body at all, and Express leaves `req.body`
 *  undefined when there is nothing to parse. Accepting that and reading it as
 *  an empty object is what makes the no-decision case reach the handler and
 *  answer 409 rather than 400. */
export const adminDeleteUserSchema = z
  .object({ decision: z.literal("purge").optional() })
  .nullish()
  .transform((body) => body ?? {});

export const adminInvitationSchema = z.object({
  /** A hint the admin types, not a rule the accept flow enforces. */
  email: z.string().trim().max(254).nullable().optional(),
  role: roleSchema.default("member"),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  send: z.boolean().optional().default(false),
});

/** Body for PUT /api/admin/mail */
export const adminMailSchema = z.object({
  host: z.string().trim().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  user: z.string().trim().optional().default(""),
  password: z.string().optional(),
  from: z.string().trim().min(1, "From address is required"),
  replyTo: z.string().trim().optional().default(""),
});

/** Body for PUT /api/admin/settings. Either field may be sent alone. */
export const adminSettingsSchema = z
  .object({
    registrationOpen: z.boolean().optional(),
    sessionTtlDays: z.number().int().optional(),
    // An empty string is a real value here: it is how a name is cleared.
    // `setInstanceName` trims, strips control characters, and enforces the
    // length, so this only has to say what kind of thing it is.
    instanceName: z.string().max(200).optional(),
    magicLinkSignIn: z.boolean().optional(),
    trashRetentionDays: z.number().int().min(1).max(365).optional(),
    backupIntervalHours: z.number().int().min(0).max(168).optional(),
    backupKeep: z.number().int().min(1).max(50).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send a setting to change",
  });

/** Body for PUT /api/admin/integrations. */
export const adminIntegrationsSchema = z
  .object({
    googleOAuth: z
      .object({
        clientId: z.string().trim().min(1, "Client ID is required"),
        clientSecret: z.string().trim().min(1, "Client Secret is required"),
      })
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send an integration to change",
  });

/** Query for GET /api/admin/audit. `before` is the opaque cursor a previous
 *  page returned as `nextBefore`. */
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().min(1).optional(),
  /** Comma-separated actions, each of which must be one the app writes. */
  action: z.string().min(1).optional(),
});
