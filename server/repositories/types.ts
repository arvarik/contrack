// Server-side types, inferred from the Drizzle schema: the shapes
// ContactRepository returns and the child record payloads it takes. The
// frontend mirrors them in `src/types.ts`; keep the two in step.

import type * as schema from "../db/schema.ts";

// Row types, each `typeof schema.X.$inferSelect`, the exact shape of a Drizzle
// SELECT. Aliases, not hand-written interfaces, so a dropped column breaks the
// code that still reads it.

/** Raw `contacts` row — all columns, before child hydration. */
export type ContactRow = typeof schema.contacts.$inferSelect;
// HydratedContact — the fully-joined API response shape

/**
 * A contact with every child relation loaded: what
 * `ContactRepository.hydrate()` returns and GET /api/contacts/:id sends.
 * SQLite's 0/1 becomes a boolean for `isPrimary` on emails, phones and
 * addresses, `isCurrent` on experience, and `isGhost`, `isArchived` and
 * `isTracked` on the contact.
 */
export interface HydratedContact extends Omit<
  ContactRow,
  "isGhost" | "isArchived" | "isTracked"
> {
  isGhost: boolean;
  isArchived: boolean;
  isTracked: boolean;
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

// ChildRecordsPayload — inbound mutation shape

/**
 * Scalar contact fields accepted from create and update payloads, after Zod.
 * Everything is optional: Zod checked the shapes, this types the allow list.
 */
export interface ContactScalarPayload {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  role?: string | null;
  company?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  themeColor?: string | null;
  isGhost?: boolean;
  isArchived?: boolean;
  isTracked?: boolean;
  nextFollowUpAt?: string | null;
  aiSummary?: string | null;
  aiBackground?: string | null;
  /** Research record JSON (shared/researchRecord.ts). */
  aiResearch?: string | null;
  aiBriefing?: string | null;
  aiBriefingAt?: string | null;
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
 * The full inbound contact payload: scalars and child arrays. The Record part
 * keeps passthrough keys readable as `unknown` (the Zod schemas allow extra
 * keys, and buildContactUpdate filters them through its allow list).
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
