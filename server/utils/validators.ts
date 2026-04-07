import { z } from 'zod';

// ============================================================================
// Foundation / Base Values
// ============================================================================

const stringToBool = z.union([z.boolean(), z.string()]).transform((val) => {
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === '1';
}).optional();

// ============================================================================
// Child Records Schemas
// ============================================================================

export const emailSchema = z.union([
  z.string(),
  z.object({
    email: z.string().email().or(z.string().min(1)),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  })
]);

export const phoneSchema = z.union([
  z.string(),
  z.object({
    phone: z.string().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  })
]);

export const addressSchema = z.union([
  z.string(),
  z.object({
    address: z.string().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  })
]);

export const socialLinkSchema = z.union([
  z.string(),
  z.object({
    url: z.string().url().or(z.string().min(1)),
    platform: z.string().nullable().optional(),
    handle: z.string().nullable().optional(),
  })
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
  })
]);

export const tagSchema = z.union([
  z.string(),
  z.object({ tag: z.string().min(1) })
]);

export const interestSchema = z.union([
  z.string(),
  z.object({
    interest: z.string().min(1),
    isAiGenerated: stringToBool,
  })
]);

export const attributeSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

// A complete child-records payload object
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
export const contactCreateSchema = z.object({
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
  avatarUrl: z.string().nullable().optional(),
  themeColor: z.string().nullable().optional(),
  preferences: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  pronouns: z.string().nullable().optional(),
  isGhost: stringToBool,
  isArchived: stringToBool,
  nextFollowUpAt: z.string().nullable().optional(),
}).merge(childRecordsSchema);

/** Payload for PUT /contacts/:id (Contact update) */
export const contactUpdateSchema = contactCreateSchema.partial();

/** Payload for POST /contacts/bulk */
export const contactBulkCreateSchema = z.array(contactCreateSchema);

/** Payload for POST /interactions. Type is an open string — known types: note, call, meeting, email, message, sms, linkedin, facebook, import */
export const interactionCreateSchema = z.object({
  type: z.string().min(1, "Type is required"),
  title: z.string().min(1, "Title is required"),
  content: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  isViaId: z.string().nullable().optional(),
  isViaName: z.string().nullable().optional(),
  actionItem: z.object({
    title: z.string().min(1, "Action item title is required"),
    dueAt: z.string().min(1, "Action item due date is required"),
  }).optional(),
}).passthrough();

/** Payload for POST /contacts/:id/action-items */
export const actionItemCreateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  dueAt: z.string().min(1, "Due date is required"),
});

/** Payload for PATCH /action-items/:id (snooze / edit) */
export const actionItemUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  dueAt: z.string().min(1).optional(),
});

/** Payload for POST /lists */
export const listCreateSchema = z.object({
  name: z.string().min(1, "List name is required"),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().nullable().optional(),
});
import { Request, Response, NextFunction } from "express";
export const validateBody = (schema: z.ZodTypeAny) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ status: "error", code: "VALIDATION_ERROR", message: "Invalid request payload", details: e.issues });
      } else {
        next(e);
      }
    }
  };
};
