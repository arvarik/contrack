// =============================================================================
// Contracts: the pieces more than one area uses
// =============================================================================
// Dates, ID lists, the child records of a contact body, and the readers for
// query strings that routes used to parse by hand. Request schemas here keep
// the parse behaviour they had in `server/utils/validators.ts`, transforms
// included. Response schemas never transform.
// =============================================================================

import { z } from "zod";

/** A boolean, or the words a CSV or a form sends for one. */
export const stringToBool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    return val === "true" || val === "1";
  })
  .optional();

/** Accept a valid calendar date or ISO timestamp. Normalize timestamps to UTC. */
export const dateSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true, local: true })], {
    error: "Use an ISO 8601 date, such as 2026-11-03 or 2026-11-03T15:00:00Z",
  })
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

/**
 * Whether Intl knows the zone. A bad name must be refused, not defaulted.
 *
 * A copy of `isValidTimeZone` in `server/services/search/datePhrases.ts`,
 * because `shared/` never imports `server/`. Change both together.
 */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Query strings that routes read by hand before they had a contract
// =============================================================================
// These routes never refused a query value: a word where a number belongs
// read as the default, and a number past the cap read as the cap. A repeated
// key arrives as an array. A repeated `limit`, `role` or `company` was read
// as its values joined by commas, while a repeated `fields`, `industry`,
// `since` or `type` (`?fields=a&fields=b`, `/api/timeline?type=a&type=b`)
// answered 500. The readers below keep all of that except the 500: they read
// every repeated key as its values joined by commas. So no client that
// worked starts getting a 400, and the ones that got a 500 get an answer.

/** Text, with a repeated key read as its values joined by commas. */
export const queryText = z.preprocess(
  (value) => (Array.isArray(value) ? value.join(",") : value),
  z.string().optional(),
);

/**
 * A whole number read the way `parseInt` reads it, kept between `min` and
 * `max`. An absent value, a value with no number in it, and zero read as
 * `fallback`. The number is kept between the bounds before the integer check,
 * so a number past the safe integers reads as `max` rather than a 400.
 */
export function queryInt(fallback: number, min: number, max: number) {
  return z
    .preprocess((value) => {
      const parsed = parseInt(String(value), 10);
      if (Number.isNaN(parsed) || parsed === 0) return fallback;
      return Math.min(Math.max(parsed, min), max);
    }, z.number().int())
    .default(fallback);
}

// =============================================================================
// The child records of a contact body
// =============================================================================

const emailSchema = z.union([
  z.string(),
  z.object({
    email: z.string().email().or(z.string().trim().min(1)),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

const phoneSchema = z.union([
  z.string(),
  z.object({
    phone: z.string().trim().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

const addressSchema = z.union([
  z.string(),
  z.object({
    address: z.string().trim().min(1),
    label: z.string().nullable().optional(),
    isPrimary: stringToBool,
  }),
]);

const socialLinkSchema = z.union([
  z.string(),
  z.object({
    url: z.string().url().or(z.string().trim().min(1)),
    platform: z.string().nullable().optional(),
    handle: z.string().nullable().optional(),
  }),
]);

const educationSchema = z.object({
  school: z.string().trim().min(1),
  degree: z.string().nullable().optional(),
  fieldOfStudy: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const experienceSchema = z.object({
  company: z.string().trim().min(1),
  role: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isCurrent: stringToBool,
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});

const sourceSchema = z.union([
  z.string(),
  z.object({
    platform: z.string().trim().min(1),
    externalId: z.string().nullable().optional(),
    connectedOn: z.string().nullable().optional(),
    rawData: z.string().nullable().optional(),
  }),
]);

const tagSchema = z.union([
  z.string().trim().min(1, "Tag cannot be empty").max(100),
  z.object({ tag: z.string().trim().min(1, "Tag cannot be empty").max(100) }),
]);

const interestSchema = z.union([
  z.string(),
  z.object({
    interest: z.string().trim().min(1),
    // A contact's interests answer the flag as stored, 0 or 1, and the
    // contact page sends them back as it got them.
    isAiGenerated: z
      .union([
        z.boolean(),
        z.enum(["true", "false", "1", "0"]),
        z.literal(0),
        z.literal(1),
      ])
      .nullable()
      .transform(
        (val) => val === true || val === "true" || val === "1" || val === 1,
      )
      .optional(),
  }),
]);

const attributeSchema = z.object({
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

// =============================================================================
// Answers more than one area sends
// =============================================================================

/** `{ success: true }`, the answer of a write that has nothing else to say. */
export const okSchema = z.strictObject({ success: z.literal(true) });

/**
 * The meta of a column an answer sends that a client should not rely on,
 * such as `ownerId`. The OpenAPI file marks it deprecated, so a later
 * version can stop sending it.
 */
export const INTERNAL = {
  description: "Internal. May be removed in a later version.",
  deprecated: true,
} as const;
