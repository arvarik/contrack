import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "./AppError.ts";

// ============================================================================
// Foundation / Base Values
// ============================================================================

const stringToBool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    return val === "true" || val === "1";
  })
  .optional();

/** Accept a valid calendar date or ISO timestamp. Normalize timestamps to UTC. */
export const dateSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true, local: true })])
  .transform((value) =>
    value.length === 10 ? value : new Date(value).toISOString(),
  );

/**
 * A date that has already happened.
 *
 * `dateSchema` alone is wrong for an interaction, because an interaction is
 * something that took place. A future one is a data error, and it has a cost
 * beyond the row itself: `contacts.lastContactedAt` is the newest interaction
 * date, and `recencyScore` returns 100 for any date at or ahead of now while
 * the curve underneath gives 91.68 one millisecond later. So one future
 * interaction pins a contact's recency signal at full marks until the next
 * real one arrives. Recorded as A-05 in `.agent/STATUS.md`.
 *
 * Five minutes of slack, and the reason is clocks rather than kindness. A
 * browser whose clock runs a minute ahead of the server stamps "now" as the
 * near future, and refusing that would refuse an honest write. Five minutes
 * cannot move a recency score that is measured in days.
 *
 * `nextFollowUpAt` deliberately keeps `dateSchema`: a follow-up is supposed to
 * be in the future.
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const pastDateSchema = dateSchema.refine(
  (value) => {
    if (value.length === 10) {
      // A date with no time names a day rather than an instant, so the
      // question is whether that day has arrived. One day of slack, for a
      // client east of UTC whose local today is tomorrow here. A date-only
      // value parses to midnight, so today can never be ahead of now anyway,
      // and the `MIN` in interactionService holds the slack case.
      const latest = new Date(Date.now() + ONE_DAY_MS)
        .toISOString()
        .slice(0, 10);
      return value <= latest;
    }
    return new Date(value).getTime() <= Date.now() + FUTURE_TOLERANCE_MS;
  },
  { message: "Date cannot be in the future" },
);

/** Validate a bounded ID list and remove duplicate IDs before writes. */
export const idsSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(1)
  .max(5000)
  .transform((ids) => [...new Set(ids)]);

// ============================================================================
// Child Records Schemas
// ============================================================================

export const emailSchema = z.union([
  z.string(),
  z.object({
    email: z.string().email().or(z.string().trim().min(1)),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

export const phoneSchema = z.union([
  z.string(),
  z.object({
    phone: z.string().trim().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

export const addressSchema = z.union([
  z.string(),
  z.object({
    address: z.string().trim().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

export const socialLinkSchema = z.union([
  z.string(),
  z.object({
    url: z.string().url().or(z.string().trim().min(1)),
    platform: z.string().nullable().optional(),
    handle: z.string().nullable().optional(),
  }),
]);

export const educationSchema = z.object({
  school: z.string().trim().min(1),
  degree: z.string().nullable().optional(),
  fieldOfStudy: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const experienceSchema = z.object({
  company: z.string().trim().min(1),
  role: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isCurrent: stringToBool,
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});

export const sourceSchema = z.union([
  z.string(),
  z.object({
    platform: z.string().trim().min(1),
    externalId: z.string().nullable().optional(),
    connectedOn: z.string().nullable().optional(),
    rawData: z.string().nullable().optional(),
  }),
]);

export const tagSchema = z.union([
  z.string(),
  z.object({ tag: z.string().trim().min(1) }),
]);

export const interestSchema = z.union([
  z.string(),
  z.object({
    interest: z.string().trim().min(1),
    isAiGenerated: stringToBool,
  }),
]);

export const attributeSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string(),
});

export const childRecordsSchema = z.object({
  emails: z.array(emailSchema).max(100).optional(),
  phones: z.array(phoneSchema).max(100).optional(),
  addresses: z.array(addressSchema).max(100).optional(),
  socialLinks: z.array(socialLinkSchema).max(100).optional(),
  education: z.array(educationSchema).max(100).optional(),
  experience: z.array(experienceSchema).max(100).optional(),
  sources: z.array(sourceSchema).max(100).optional(),
  tags: z.array(tagSchema).max(100).optional(),
  interests: z.array(interestSchema).max(100).optional(),
  attributes: z.array(attributeSchema).max(100).optional(),
});

// ============================================================================
// Core Entity Schemas
// ============================================================================

/** Payload for POST /contacts (Contact creation) */
export const contactCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(300),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    headline: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    industry: z.string().nullable().optional(),
    about: z.string().nullable().optional(),
    aiSummary: z.string().nullable().optional(),
    aiBackground: z.string().nullable().optional(),
    aiBriefing: z.string().nullable().optional(),
    aiBriefingAt: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    themeColor: z.string().nullable().optional(),
    preferences: z.string().nullable().optional(),
    birthday: z.string().nullable().optional(),
    pronouns: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    cadenceDays: z.number().int().positive().nullable().optional(),
    isGhost: stringToBool,
    isArchived: stringToBool,
    nextFollowUpAt: dateSchema.nullable().optional(),
  })
  .merge(childRecordsSchema);

export const contactUpdateSchema = contactCreateSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

// Cap bulk imports — combined with the 50 MB JSON body limit, an unbounded
// array lets one request allocate arbitrary memory.
export const contactBulkCreateSchema = z.array(contactCreateSchema).max(5000);

/** Payload for POST /interactions. Type is open string. */
export const interactionCreateSchema = z.object({
  type: z.string().trim().min(1, "Type is required"),
  title: z.string().trim().min(1, "Title is required"),
  content: z.string().nullable().optional(),
  date: pastDateSchema.nullable().optional(),
  duration: z.number().nonnegative().max(525600).nullable().optional(),
  source: z.string().nullable().optional(),
  isViaId: z.string().nullable().optional(),
  isViaName: z.string().nullable().optional(),
  actionItem: z
    .object({
      title: z.string().trim().min(1, "Action item title is required"),
      dueAt: dateSchema,
    })
    .optional(),
});

/** Payload for PATCH /interactions/:id — only title and content are mutable. */
export const interactionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    content: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

export const actionItemCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  dueAt: dateSchema,
});

export const actionItemUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    dueAt: dateSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

export const listCreateSchema = z.object({
  name: z.string().trim().min(1, "List name is required").max(60),
  icon: z.string().optional(),
});

export const listUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    icon: z.string().optional(),
  })
  .refine((d) => d.name !== undefined || d.icon !== undefined, {
    message: "At least one of name or icon is required",
  });

// ============================================================================
// Administration Schemas
// ============================================================================
//
// Shape only. The semantic rules — is this username reserved, is this email
// already taken, is this password long enough — stay in authService, which is
// the one place that knows them and the one place the self-service paths use.

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
});

/** Body for POST /api/auth/accept-invitation.
 *
 *  `token` is any string, empty included, on purpose. Every string reaches
 *  the service and comes back as one 404, so an empty token, a token of the
 *  wrong shape and a token that simply is not in the table are three inputs
 *  with one answer. A `min(1)` here would answer an empty token with a 400
 *  that names the field, which is one bit more than a caller should learn. */
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

/** Body for POST /api/auth/tokens. */
export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
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
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send a setting to change",
  });

/** Query for GET /api/admin/audit. `before` is the opaque cursor a previous
 *  page returned as `nextBefore`. */
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().min(1).optional(),
  /** Comma-separated actions, each of which must be one the app writes. */
  action: z.string().min(1).optional(),
});

// ============================================================================
// Middleware Factories
// ============================================================================
//
// All three throw `ValidationError` (which the central error handler renders
// as a 400 with `code: "VALIDATION_ERROR"` and the Zod issue list as
// `details`). Routes therefore never reach into `res` from inside a
// validator — that responsibility belongs to the error middleware.

function runOrThrow<T>(
  schema: z.ZodTypeAny,
  value: unknown,
  where: "body" | "params" | "query",
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid request ${where}`, result.error.issues);
  }
  return result.data as T;
}

export const validateBody = (schema: z.ZodTypeAny) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = runOrThrow(schema, req.body, "body");
    next();
  };
};
