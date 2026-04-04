// =============================================================================
// Repository Types — Server-Side Typed Interfaces
// =============================================================================
// These types are inferred from the Drizzle schema to guarantee compile-time
// correctness. They describe the shapes returned by ContactRepository methods
// and the expected shape of inbound child record payloads.
// =============================================================================

import type * as schema from "../../src/db/schema.ts";

// =============================================================================
// Row types — inferred from Drizzle schema (read-side)
// =============================================================================

export type ContactRow = typeof schema.contacts.$inferSelect;
export type ContactEmailRow = typeof schema.contactEmails.$inferSelect;
export type ContactPhoneRow = typeof schema.contactPhones.$inferSelect;
export type ContactSocialLinkRow = typeof schema.contactSocialLinks.$inferSelect;
export type ContactEducationRow = typeof schema.contactEducation.$inferSelect;
export type ContactExperienceRow = typeof schema.contactExperience.$inferSelect;
export type ContactSourceRow = typeof schema.contactSources.$inferSelect;
export type ContactTagRow = typeof schema.contactTags.$inferSelect;
export type ContactInterestRow = typeof schema.contactInterests.$inferSelect;
export type ContactAttributeRow = typeof schema.contactAttributes.$inferSelect;
export type ContactAddressRow = typeof schema.contactAddresses.$inferSelect;

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
  interests: Array<{ id: string; interest: string; isAiGenerated: number | boolean | null }>;
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
export interface ChildRecordsPayload {
  emails?: (string | { email: string; label?: string; isPrimary?: boolean })[];
  phones?: (string | { phone: string; label?: string; isPrimary?: boolean })[];
  socialLinks?: (string | { url: string; platform?: string; handle?: string })[];
  education?: { school: string; degree?: string; fieldOfStudy?: string; startDate?: string; endDate?: string; description?: string }[];
  experience?: { company: string; role?: string; startDate?: string; endDate?: string; isCurrent?: boolean; description?: string; location?: string }[];
  tags?: (string | { tag: string })[];
  sources?: (string | { platform: string; externalId?: string; connectedOn?: string; rawData?: string })[];
  interests?: (string | { interest: string; isAiGenerated?: boolean })[];
  attributes?: { name: string; value: string }[];
  addresses?: (string | { address: string; label?: string; isPrimary?: boolean })[];
}
