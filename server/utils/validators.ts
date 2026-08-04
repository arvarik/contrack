import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "./AppError.ts";

// ============================================================================
// Foundation / Base Values
// ============================================================================

const stringToBool = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    return val === "true" || val === "1";
  })
  .optional();

// ============================================================================
// Child Records Schemas
// ============================================================================

export const emailSchema = z.union([
  z.string(),
  z.object({
    email: z.string().email().or(z.string().min(1)),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

export const phoneSchema = z.union([
  z.string(),
  z.object({
    phone: z.string().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

export const addressSchema = z.union([
  z.string(),
  z.object({
    address: z.string().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

export const socialLinkSchema = z.union([
  z.string(),
  z.object({
    url: z.string().url().or(z.string().min(1)),
    platform: z.string().nullable().optional(),
    handle: z.string().nullable().optional(),
  }),
]);

export const educationSchema = z.object({
  school: z.string().min(1),
  degree: z.string().nullable().optional(),
  fieldOfStudy: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const experienceSchema = z.object({
  company: z.string().min(1),
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
    platform: z.string().min(1),
    externalId: z.string().nullable().optional(),
    connectedOn: z.string().nullable().optional(),
    rawData: z.string().nullable().optional(),
  }),
]);

export const tagSchema = z.union([
  z.string(),
  z.object({ tag: z.string().min(1) }),
]);

export const interestSchema = z.union([
  z.string(),
  z.object({
    interest: z.string().min(1),
    isAiGenerated: stringToBool,
  }),
]);

export const attributeSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

export const childRecordsSchema = z.object({
  emails: z.array(emailSchema).optional(),
  phones: z.array(phoneSchema).optional(),
  addresses: z.array(addressSchema).optional(),
  socialLinks: z.array(socialLinkSchema).optional(),
  education: z.array(educationSchema).optional(),
  experience: z.array(experienceSchema).optional(),
  sources: z.array(sourceSchema).optional(),
  tags: z.array(tagSchema).optional(),
  interests: z.array(interestSchema).optional(),
  attributes: z.array(attributeSchema).optional(),
});

// ============================================================================
// Core Entity Schemas
// ============================================================================

/** Payload for POST /contacts (Contact creation) */
export const contactCreateSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    headline: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
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
    nextFollowUpAt: z.string().nullable().optional(),
  })
  .merge(childRecordsSchema);

export const contactUpdateSchema = contactCreateSchema.partial();

// Cap bulk imports — combined with the 50 MB JSON body limit, an unbounded
// array lets one request allocate arbitrary memory.
export const contactBulkCreateSchema = z.array(contactCreateSchema).max(5000);

/** Payload for POST /interactions. Type is open string. */
export const interactionCreateSchema = z
  .object({
    type: z.string().min(1, "Type is required"),
    title: z.string().min(1, "Title is required"),
    content: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
    isViaId: z.string().nullable().optional(),
    isViaName: z.string().nullable().optional(),
    actionItem: z
      .object({
        title: z.string().min(1, "Action item title is required"),
        dueAt: z.string().min(1, "Action item due date is required"),
      })
      .optional(),
  })
  .passthrough();

/** Payload for PATCH /interactions/:id — only title and content are mutable. */
export const interactionUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

export const actionItemCreateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  dueAt: z.string().min(1, "Due date is required"),
});

export const actionItemUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  dueAt: z.string().min(1).optional(),
});

export const listCreateSchema = z.object({
  name: z.string().min(1, "List name is required").max(60),
  icon: z.string().optional(),
});

export const listUpdateSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    icon: z.string().optional(),
  })
  .refine((d) => d.name !== undefined || d.icon !== undefined, {
    message: "At least one of name or icon is required",
  });

/** Generic id-in-URL guard. Strips empty/whitespace ids that the router would otherwise pass straight through. */
export const idParamSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
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

export const validateParams = (schema: z.ZodTypeAny) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Express params are a frozen-ish object on the request; mutate via assign
    // rather than replacement so downstream code keeps working.
    const parsed = runOrThrow<Record<string, string>>(
      schema,
      req.params,
      "params",
    );
    Object.assign(req.params, parsed);
    next();
  };
};

export const validateQuery = (schema: z.ZodTypeAny) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = runOrThrow<Record<string, unknown>>(
      schema,
      req.query,
      "query",
    );
    Object.assign(req.query, parsed);
    next();
  };
};
