// =============================================================================
// Repository Types — Server-Side Typed Interfaces
// =============================================================================
// These types are inferred from the Drizzle schema to guarantee compile-time
// correctness. They describe the shapes returned by ContactRepository methods
// and the expected shape of inbound child record payloads.
//
// IMPORTANT: The frontend mirrors these shapes in `src/types.ts`.
// If you modify anything here, verify the frontend counterpart stays in sync.
// =============================================================================

import type * as schema from "../../src/db/schema.ts";

// =============================================================================
// Row types — inferred from Drizzle schema (read-side)
// =============================================================================
//
// Each of these is `typeof schema.X.$inferSelect`, which produces the exact
// shape returned by a Drizzle SELECT. Using these aliases (instead of
// re-declaring fields) means schema changes propagate automatically: drop a
// column from the Drizzle table and any downstream code referencing the
// removed field stops type-checking. Do NOT replace these with hand-written
// interfaces.
// =============================================================================

/** Raw `contacts` row — all columns, before child hydration. */
export type ContactRow = typeof schema.contacts.$inferSelect;
/** Raw `contact_phones` row — one per phone-per-contact. */
export type ContactPhoneRow = typeof schema.contactPhones.$inferSelect;
/** Raw `contact_education` row — one per school+degree pair. */
export type ContactEducationRow = typeof schema.contactEducation.$inferSelect;
/** Raw `contact_experience` row — one per job/role. */
export type ContactExperienceRow = typeof schema.contactExperience.$inferSelect;
/** Raw `contact_sources` row — one per import provenance. */
export type ContactSourceRow = typeof schema.contactSources.$inferSelect;
// =============================================================================
// HydratedContact — the fully-joined API response shape
// =============================================================================

/**
 * A contact row with all child relations eagerly loaded.
 * This is the shape returned by `ContactRepository.hydrate()` and sent
 * over the wire as the JSON response for GET /api/contacts/:id.
 *
 * Integer booleans from SQLite (0/1) are converted to JS booleans for:
 * - `isPrimary` on emails, phones, addresses
 * - `isCurrent` on experience
 * - `isGhost`, `isArchived` on the contact itself
 */
export interface HydratedContact extends ContactRow {
  emails: Array<{
    id: string;
    email: string;
    label: string | null;
    isPrimary: boolean;
    source: string | null;
  }>;
  phones: Array<{
    id: string;
    phone: string;
    label: string | null;
    isPrimary: boolean;
    source: string | null;
  }>;
  socialLinks: Array<{
    id: string;
    platform: string;
    url: string;
    handle: string | null;
    source: string | null;
  }>;
  education: Array<{
    id: string;
    school: string;
    degree: string | null;
    fieldOfStudy: string | null;
    startDate: string | null;
    endDate: string | null;
    description: string | null;
  }>;
  experience: Array<{
    id: string;
    company: string;
    role: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string | null;
    location: string | null;
  }>;
  sources: Array<{
    id: string;
    platform: string;
    externalId: string | null;
    connectedOn: string | null;
    importedAt: string | null;
  }>;
  tags: Array<{ id: string; tag: string }>;
  interests: Array<{
    id: string;
    interest: string;
    isAiGenerated: number | boolean | null;
  }>;
  attributes: Array<{ id: string; name: string; value: string }>;
  addresses: Array<{
    id: string;
    address: string;
    label: string | null;
    isPrimary: boolean;
    source: string | null;
  }>;
  lists: Array<{ id: string; name: string; icon: string }>;
  interactionCount: number;
}

// =============================================================================
// ChildRecordsPayload — inbound mutation shape
// =============================================================================

/**
 * Type definition for inbound payload containing potential relational data
 * to append to a given Contact profile during Creation or Hydration.
 *
 * Each array accepts either a plain string (shorthand) or a structured object.
 * The repository normalizes these unions internally.
 */
/**
 * Scalar contact fields accepted from create/update payloads (post-Zod).
 * Everything is optional — Zod has validated shapes, this types the allow-list.
 */
export interface ContactScalarPayload {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  role?: string | null;
  company?: string | null;
  location?: string | null;
  birthday?: string | null;
  preferences?: string | null;
  avatarUrl?: string | null;
  cadenceDays?: number | null;
  about?: string | null;
  pronouns?: string | null;
  industry?: string | null;
  website?: string | null;
}

/**
 * Full inbound contact payload: scalars + child arrays. The Record part
 * keeps passthrough keys readable as `unknown` (the Zod schemas allow
 * extra keys; buildContactUpdate re-filters through its allow-list).
 */
export type ContactPayload = ContactScalarPayload &
  ChildRecordsPayload & {
    /** Stamped by the bulk-import flow to record provenance. */
    _sourcePlatform?: string;
  } & Record<string, unknown>;

/** A create payload — identical to ContactPayload but `name` is required. */
export type NewContactPayload = ContactPayload & { name: string };

export interface ChildRecordsPayload {
  emails?: (string | { email: string; label?: string; isPrimary?: boolean })[];
  phones?: (string | { phone: string; label?: string; isPrimary?: boolean })[];
  socialLinks?: (
    string | { url: string; platform?: string; handle?: string }
  )[];
  education?: {
    school: string;
    degree?: string;
    fieldOfStudy?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }[];
  experience?: {
    company: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
    description?: string;
    location?: string;
  }[];
  tags?: (string | { tag: string })[];
  sources?: (
    | string
    | {
        platform: string;
        externalId?: string;
        connectedOn?: string;
        rawData?: string;
      }
  )[];
  interests?: (string | { interest: string; isAiGenerated?: boolean })[];
  attributes?: { name: string; value: string }[];
  addresses?: (
    string | { address: string; label?: string; isPrimary?: boolean }
  )[];
}
