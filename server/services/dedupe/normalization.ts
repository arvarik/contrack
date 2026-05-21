// =============================================================================
// Dedupe Normalization Pipeline — Contact Pre-Processing for Entity Resolution
// =============================================================================
// Transforms raw database contacts into comparison-ready NormalizedContact
// structures. This is the Tier 0 layer of the dedupe funnel — all subsequent
// matching tiers operate on NormalizedContact, never raw DB rows.
//
// Design principles:
// - Batch SQL loading: emails, phones, sources loaded in 3 queries, not N+1
// - Pure computation after SQL: normalizeContact() is side-effect-free
// - Idempotent: calling normalizeContacts() twice yields identical results
// - Embedding-ready: embeddingText is pre-formatted for Gemini API
// =============================================================================

import { sqlite } from "../../db.ts";
import {
  normalizePhone,
  normalizeCompany,
  doubleMetaphone,
  tokenizeName,
} from "../../utils/nlp/index.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Raw contact row from the database — the minimal shape needed for normalization.
 * Uses `any` for optional fields since SQLite returns null for missing columns.
 */
export interface RawContactRow {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
  industry?: string | null;
  headline?: string | null;
  about?: string | null;
  preferences?: string | null;
}

/**
 * Fully normalized contact record ready for dedupe comparison.
 * Every string field is lowercase/trimmed. Phonetic codes and blocking keys
 * are pre-computed so matching passes never recompute them.
 */
export interface NormalizedContact {
  id: string;
  // Name components
  nameNorm: string; // lowercase, title-stripped, trimmed
  nameTokens: string[]; // tokenized name parts (via NLP tokenizer)
  firstNameNorm: string; // first token (or empty string)
  lastNameNorm: string; // last token (or empty string)
  phoneticHash: string; // Double Metaphone of full normalized name
  firstNamePhonetic: string; // Double Metaphone of first name only
  lastNamePhonetic: string; // Double Metaphone of last name only
  // Identifiers
  emailsNorm: string[]; // lowercased, trimmed
  phonesNorm: string[]; // last 10 digits only
  companyNorm: string; // suffix-stripped, lowercase
  // Context
  role: string | null;
  location: string | null;
  industry: string | null;
  // Provenance
  sources: string[]; // platform names: ['apple', 'linkedin', ...]
  // Derived keys
  blockKeys: string[]; // multi-key blocking keys for Tier 3
  embeddingText: string; // pre-formatted for Gemini embedding API
}

// tokenizeName is imported directly from nlp.ts (pure-functional string utility)

// =============================================================================
// Blocking Key Generation
// =============================================================================

/**
 * Generate multi-key blocking keys for a normalized contact.
 * Each key becomes an entry in an inverted index — contacts sharing a key
 * become candidate pairs for comparison.
 *
 * Key prefixes ensure no collisions between key types:
 * - LN:  Last name exact
 * - LNM: Last name Metaphone
 * - FL3: First 3 chars of first name + last name (catches "Jonathan/John")
 * - CF:  Company + first initial (same company, same first letter)
 * - EM:  Normalized email (already catches exact matches, but useful for blocking)
 * - PH:  Normalized phone (ditto)
 */
export function generateBlockKeys(contact: NormalizedContact): string[] {
  const keys: string[] = [];

  // LN: Last name exact (most contacts share a last name with at least one other)
  if (contact.lastNameNorm.length >= 2) {
    keys.push(`LN:${contact.lastNameNorm}`);
  }

  // LNM: Last name phonetic (catches "Smith" ↔ "Smyth")
  if (contact.lastNamePhonetic) {
    keys.push(`LNM:${contact.lastNamePhonetic}`);
  }

  // FL3: First 3 chars of first name + full last name
  // This catches "Jonathan Smith" ↔ "John Smith" (both have FL3 "joh:smith")
  if (contact.firstNameNorm.length >= 3 && contact.lastNameNorm.length >= 2) {
    keys.push(
      `FL3:${contact.firstNameNorm.slice(0, 3)}:${contact.lastNameNorm}`,
    );
  }

  // CF: Company + first initial (same company, same starting letter)
  if (contact.companyNorm.length >= 2 && contact.firstNameNorm.length >= 1) {
    keys.push(`CF:${contact.companyNorm}:${contact.firstNameNorm[0]}`);
  }

  // EM: Each normalized email
  for (const email of contact.emailsNorm) {
    keys.push(`EM:${email}`);
  }

  // PH: Each normalized phone
  for (const phone of contact.phonesNorm) {
    if (phone.length >= 7) {
      keys.push(`PH:${phone}`);
    }
  }

  return keys;
}

// =============================================================================
// Embedding Text Generation
// =============================================================================

/**
 * Format a contact's key fields into a string suitable for embedding via
 * Gemini's `gemini-embedding-2-preview` model.
 *
 * Uses the `task: clustering | query: ...` prompt format required by the
 * new embedding model (it uses prompt-based task instructions, not the old
 * `task_type` enum).
 */
export function contactToEmbeddingString(
  contact: NormalizedContact,
  raw: RawContactRow,
  tags?: string[],
  interests?: string[],
): string {
  const parts: string[] = [];
  if (raw.name) parts.push(`Name: ${raw.name}`);
  if (raw.company) parts.push(`Company: ${raw.company}`);
  if (raw.role) parts.push(`Role: ${raw.role}`);
  if (raw.location) parts.push(`Location: ${raw.location}`);
  if (raw.industry) parts.push(`Industry: ${raw.industry}`);
  if (raw.headline) parts.push(`Headline: ${raw.headline}`);
  if (raw.about) parts.push(`About: ${raw.about.slice(0, 200)}`);
  if (raw.preferences)
    parts.push(`Preferences: ${raw.preferences.slice(0, 200)}`);
  if (contact.emailsNorm.length)
    parts.push(`Emails: ${contact.emailsNorm.join(", ")}`);
  if (contact.phonesNorm.length)
    parts.push(`Phones: ${contact.phonesNorm.join(", ")}`);

  // Include tags and interests for rich semantic matching
  // (e.g., "who likes espresso?" should match contacts with espresso in interests)
  let combined: string[] = [];
  if (tags && interests) {
    combined = [...tags, ...interests];
  } else {
    const tagRows = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(raw.id) as { tag: string }[];
    const interestRows = sqlite
      .prepare("SELECT interest FROM contact_interests WHERE contactId = ?")
      .all(raw.id) as { interest: string }[];
    combined = [
      ...tagRows.map((t) => t.tag),
      ...interestRows.map((i) => i.interest),
    ];
  }
  if (combined.length > 0) parts.push(`Interests: ${combined.join(", ")}`);

  const content = parts.join(" | ");
  return `task: clustering | query: ${content}`;
}

// =============================================================================
// Single Contact Normalization
// =============================================================================

/**
 * Normalize a single contact row with pre-loaded child data.
 *
 * @param raw         - The contact row from the contacts table
 * @param emails      - Pre-loaded email rows for this contact
 * @param phones      - Pre-loaded phone rows for this contact
 * @param sourcePlatforms - Pre-loaded source platform names for this contact
 */
export function normalizeContact(
  raw: RawContactRow,
  emails: { email: string }[],
  phones: { phone: string }[],
  sourcePlatforms: string[],
  tags?: string[],
  interests?: string[],
): NormalizedContact {
  // Name processing
  const nameTokens = tokenizeName(raw.name);
  const nameNorm = nameTokens.join(" ");
  const firstNameNorm = nameTokens[0] ?? "";
  const lastNameNorm =
    nameTokens.length > 1
      ? nameTokens[nameTokens.length - 1]
      : (nameTokens[0] ?? "");

  // Phonetic hashes
  const phoneticHash = doubleMetaphone(raw.name).primary;
  const firstNamePhonetic = firstNameNorm
    ? doubleMetaphone(firstNameNorm).primary
    : "";
  const lastNamePhonetic = lastNameNorm
    ? doubleMetaphone(lastNameNorm).primary
    : "";

  // Identifiers
  const emailsNorm = emails
    .map((e) => e.email.toLowerCase().trim())
    .filter((e) => e.length > 0);

  const phonesNorm = phones
    .map((p) => normalizePhone(p.phone))
    .filter((p) => p.length >= 7);

  const companyNorm = normalizeCompany(raw.company ?? "");

  // Build the contact
  const contact: NormalizedContact = {
    id: raw.id,
    nameNorm,
    nameTokens,
    firstNameNorm,
    lastNameNorm,
    phoneticHash,
    firstNamePhonetic,
    lastNamePhonetic,
    emailsNorm,
    phonesNorm,
    companyNorm,
    role: raw.role ?? null,
    location: raw.location ?? null,
    industry: raw.industry ?? null,
    sources: sourcePlatforms,
    blockKeys: [], // generated below
    embeddingText: "", // generated below
  };

  // Derived fields (depend on the contact being fully built)
  contact.blockKeys = generateBlockKeys(contact);
  contact.embeddingText = contactToEmbeddingString(
    contact,
    raw,
    tags,
    interests,
  );

  return contact;
}

// =============================================================================
// Batch Normalization (Performance-Optimized)
// =============================================================================

/**
 * Normalize all active contacts in a single efficient pass.
 *
 * Instead of N+1 queries (1 per contact for emails, phones, sources),
 * this loads ALL child data in 3 bulk queries and builds lookup maps.
 * For 1,082 contacts, this takes ~20ms instead of ~3,000ms.
 *
 * @param contactFilter - Optional SQL WHERE clause fragment for the contacts query.
 *                         Default: only active, non-ghost, non-archived contacts.
 * @returns Array of NormalizedContact ready for dedupe matching.
 */
export function normalizeContacts(
  contactFilter = "isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL",
): NormalizedContact[] {
  // 1. Load all contacts
  const allContacts = sqlite
    .prepare(
      `SELECT id, name, firstName, lastName, company, role, location, industry, headline, about, preferences
     FROM contacts WHERE ${contactFilter}`,
    )
    .all() as RawContactRow[];

  if (allContacts.length === 0) return [];

  // 2. Batch-load all emails → Map<contactId, emails[]>
  const allEmails = sqlite
    .prepare("SELECT contactId, email FROM contact_emails")
    .all() as { contactId: string; email: string }[];

  const emailsByContact = new Map<string, { email: string }[]>();
  for (const e of allEmails) {
    if (!emailsByContact.has(e.contactId)) emailsByContact.set(e.contactId, []);
    emailsByContact.get(e.contactId)!.push({ email: e.email });
  }

  // 3. Batch-load all phones → Map<contactId, phones[]>
  const allPhones = sqlite
    .prepare("SELECT contactId, phone FROM contact_phones")
    .all() as { contactId: string; phone: string }[];

  const phonesByContact = new Map<string, { phone: string }[]>();
  for (const p of allPhones) {
    if (!phonesByContact.has(p.contactId)) phonesByContact.set(p.contactId, []);
    phonesByContact.get(p.contactId)!.push({ phone: p.phone });
  }

  // 4. Batch-load all sources → Map<contactId, platforms[]>
  const allSources = sqlite
    .prepare("SELECT contactId, platform FROM contact_sources")
    .all() as { contactId: string; platform: string }[];

  const sourcesByContact = new Map<string, string[]>();
  for (const s of allSources) {
    if (!sourcesByContact.has(s.contactId))
      sourcesByContact.set(s.contactId, []);
    const platforms = sourcesByContact.get(s.contactId)!;
    if (!platforms.includes(s.platform)) platforms.push(s.platform);
  }

  // 5. Batch-load all tags → Map<contactId, tag[]>
  const allTags = sqlite
    .prepare("SELECT contactId, tag FROM contact_tags")
    .all() as { contactId: string; tag: string }[];

  const tagsByContact = new Map<string, string[]>();
  for (const t of allTags) {
    if (!tagsByContact.has(t.contactId)) tagsByContact.set(t.contactId, []);
    tagsByContact.get(t.contactId)!.push(t.tag);
  }

  // 6. Batch-load all interests → Map<contactId, interest[]>
  const allInterests = sqlite
    .prepare("SELECT contactId, interest FROM contact_interests")
    .all() as { contactId: string; interest: string }[];

  const interestsByContact = new Map<string, string[]>();
  for (const i of allInterests) {
    if (!interestsByContact.has(i.contactId))
      interestsByContact.set(i.contactId, []);
    interestsByContact.get(i.contactId)!.push(i.interest);
  }

  // 7. Normalize each contact with pre-loaded child data
  const normalized: NormalizedContact[] = [];
  for (const raw of allContacts) {
    if (!raw.name) continue; // skip nameless contacts (shouldn't happen, but safety)

    normalized.push(
      normalizeContact(
        raw,
        emailsByContact.get(raw.id) ?? [],
        phonesByContact.get(raw.id) ?? [],
        sourcesByContact.get(raw.id) ?? [],
        tagsByContact.get(raw.id) ?? [],
        interestsByContact.get(raw.id) ?? [],
      ),
    );
  }

  return normalized;
}

// =============================================================================
// Utility: Normalize a Single Contact by ID (for incremental checks)
// =============================================================================

/**
 * Load and normalize a single contact by ID.
 * Used for incremental dedup checks after contact create/edit.
 */
export function normalizeContactById(
  contactId: string,
): NormalizedContact | null {
  const raw = sqlite
    .prepare(
      "SELECT id, name, firstName, lastName, company, role, location, industry, headline, about, preferences FROM contacts WHERE id = ?",
    )
    .get(contactId) as RawContactRow | undefined;

  if (!raw || !raw.name) return null;

  const emails = sqlite
    .prepare("SELECT email FROM contact_emails WHERE contactId = ?")
    .all(contactId) as { email: string }[];

  const phones = sqlite
    .prepare("SELECT phone FROM contact_phones WHERE contactId = ?")
    .all(contactId) as { phone: string }[];

  const sources = sqlite
    .prepare(
      "SELECT DISTINCT platform FROM contact_sources WHERE contactId = ?",
    )
    .all(contactId) as { platform: string }[];

  const tags = sqlite
    .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
    .all(contactId) as { tag: string }[];

  const interests = sqlite
    .prepare("SELECT interest FROM contact_interests WHERE contactId = ?")
    .all(contactId) as { interest: string }[];

  return normalizeContact(
    raw,
    emails,
    phones,
    sources.map((s) => s.platform),
    tags.map((t) => t.tag),
    interests.map((i) => i.interest),
  );
}
