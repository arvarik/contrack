// Dedupe normalization: raw contacts into comparison-ready NormalizedContact
// records, the first tier of the dedupe funnel. Every later tier reads
// NormalizedContact, never raw rows. Emails, phones and sources load in 3
// queries, not N+1, and normalizeContact() is pure after that.

import { sqlite } from "../../db.ts";
import { scopeForOwnerId, type Scope } from "../../tenancy/scope.ts";
import {
  normalizePhone,
  normalizeCompany,
  doubleMetaphone,
  generationOf,
  tokenizeName,
} from "../../utils/nlp/index.ts";

// Types

/**
 * The raw contact row normalization needs. Optional fields are null when the
 * column is empty.
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
 * A contact ready for dedupe comparison: string fields lowercased and trimmed,
 * phonetic codes and blocking keys computed once.
 */
export interface NormalizedContact {
  id: string;
  // Name components
  nameNorm: string; // lowercase, title-stripped, trimmed
  nameTokens: string[]; // tokenized name parts (via NLP tokenizer)
  firstNameNorm: string; // first token (or empty string)
  lastNameNorm: string; // last token (or empty string)
  /**
   * The generational suffix the raw name carried, or null. The tokens above
   * have it stripped, so "Hale Sr." and "Hale Jr." tokenize alike. Two
   * different suffixes are two people, and the policy reads this to say so.
   */
  generation: string | null;
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

// Blocking keys

/**
 * Blocking keys for a contact. Each key is an entry in an inverted index, and
 * contacts sharing a key become candidate pairs. The prefixes keep key types
 * apart:
 * - LN:  last name
 * - LNM: last name Metaphone
 * - FL3: first 3 letters of the first name + last name ("Jonathan" and "John")
 * - CF:  company + first initial
 * - EM:  normalized email
 * - PH:  normalized phone
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

// Embedding text

/**
 * A contact's key fields as one embedding text, in the `task: clustering |
 * query: ...` form that gemini-embedding-2-preview reads as its task
 * instruction.
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

// One contact

/**
 * Normalize one contact row with its child data already loaded.
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
    generation: generationOf(raw.name),
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

// All contacts

/**
 * Normalize every active, non-ghost, non-archived contact of the owner. All
 * child data loads in 3 bulk queries into lookup maps, not one query per
 * contact: about 20 ms for 1,082 contacts instead of about 3 s.
 *
 * @returns Array of NormalizedContact ready for dedupe matching.
 */
export function normalizeContacts(scope: Scope): NormalizedContact[] {
  // 1. Load the owner's contacts
  const allContacts = sqlite
    .prepare(
      `SELECT id, name, firstName, lastName, company, role, location, industry, headline, about, preferences
     FROM contacts WHERE ownerId = ? AND (isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL)`,
    )
    .all(scope.ownerId) as RawContactRow[];

  if (allContacts.length === 0) return [];

  // 2. The owner's emails → Map<contactId, emails[]>. Child tables carry no
  //    owner, so each load joins back to contacts, or the maps would hold every
  //    owner's rows.
  const allEmails = sqlite
    .prepare(
      `SELECT ce.contactId, ce.email FROM contact_emails ce
       JOIN contacts c ON c.id = ce.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; email: string }[];

  const emailsByContact = new Map<string, { email: string }[]>();
  for (const e of allEmails) {
    if (!emailsByContact.has(e.contactId)) emailsByContact.set(e.contactId, []);
    emailsByContact.get(e.contactId)!.push({ email: e.email });
  }

  // 3. Batch-load all phones → Map<contactId, phones[]>
  const allPhones = sqlite
    .prepare(
      `SELECT cp.contactId, cp.phone FROM contact_phones cp
       JOIN contacts c ON c.id = cp.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; phone: string }[];

  const phonesByContact = new Map<string, { phone: string }[]>();
  for (const p of allPhones) {
    if (!phonesByContact.has(p.contactId)) phonesByContact.set(p.contactId, []);
    phonesByContact.get(p.contactId)!.push({ phone: p.phone });
  }

  // 4. Batch-load all sources → Map<contactId, platforms[]>
  const allSources = sqlite
    .prepare(
      `SELECT cs.contactId, cs.platform FROM contact_sources cs
       JOIN contacts c ON c.id = cs.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; platform: string }[];

  const sourcesByContact = new Map<string, string[]>();
  for (const s of allSources) {
    if (!sourcesByContact.has(s.contactId))
      sourcesByContact.set(s.contactId, []);
    const platforms = sourcesByContact.get(s.contactId)!;
    if (!platforms.includes(s.platform)) platforms.push(s.platform);
  }

  // 5. Batch-load all tags → Map<contactId, tag[]>
  const allTags = sqlite
    .prepare(
      `SELECT ct.contactId, ct.tag FROM contact_tags ct
       JOIN contacts c ON c.id = ct.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; tag: string }[];

  const tagsByContact = new Map<string, string[]>();
  for (const t of allTags) {
    if (!tagsByContact.has(t.contactId)) tagsByContact.set(t.contactId, []);
    tagsByContact.get(t.contactId)!.push(t.tag);
  }

  // 6. Batch-load all interests → Map<contactId, interest[]>
  const allInterests = sqlite
    .prepare(
      `SELECT ci.contactId, ci.interest FROM contact_interests ci
       JOIN contacts c ON c.id = ci.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; interest: string }[];

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

// Profile links

/**
 * A profile link reduced to what names the page: host and path, lowercased,
 * with no protocol, `www.` or mobile host, query, fragment or trailing slash. A
 * LinkedIn profile is `linkedin.com/in/<handle>`, whatever country host or
 * extra path it was saved with. Two exports of one person write a link a little
 * differently, such as "linkedin.com/in/priya-raman-42" with and without a
 * trailing slash.
 */
export function normalizeProfileUrl(url: string): string {
  const raw = url
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // The one profile whose query is the person: facebook.com/profile.php?id=.
  const facebookId =
    /^(?:www\.|m\.)?facebook\.com\/profile\.php\?(?:[^#]*&)?id=(\d+)/.exec(raw);
  if (facebookId) return `facebook.com/profile.php?id=${facebookId[1]}`;
  const bare = raw
    .replace(/[?#].*$/, "")
    .replace(/^(www|m|mobile)\./, "")
    .replace(/\/+$/, "");
  const linkedIn = /^(?:[a-z]{2}\.)?linkedin\.com\/in\/([^/]+)/.exec(bare);
  if (!linkedIn) return bare;
  let handle = linkedIn[1];
  try {
    handle = decodeURIComponent(handle);
  } catch {
    // A malformed escape stays as it was written.
  }
  return `linkedin.com/in/${handle}`;
}

/**
 * Whether a normalized link names one person rather than a group or a site. A
 * company page, a school or a group is shared by everyone there, so two
 * colleagues who saved it are not one person. A bare host names nobody.
 */
export function isPersonalProfile(normalized: string): boolean {
  const slash = normalized.indexOf("/");
  if (slash < 0 || slash === normalized.length - 1) return false;
  if (/^(?:[a-z]{2}\.)?linkedin\.com\//.test(normalized)) {
    return normalized.startsWith("linkedin.com/in/");
  }
  return !/\/(company|school|groups?|pages|showcase|events|jobs)(\/|$)/.test(
    normalized,
  );
}

/**
 * Every personal profile link the account's contacts carry, normalized, by
 * contact. One scoped read for the scan and the import check alike.
 */
export function loadProfileUrls(scope: Scope): Map<string, string[]> {
  const rows = sqlite
    .prepare(
      `SELECT sl.contactId, sl.url FROM contact_social_links sl
       JOIN contacts c ON c.id = sl.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; url: string | null }[];
  const byContact = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.url) continue;
    const url = normalizeProfileUrl(row.url);
    if (!isPersonalProfile(url)) continue;
    const urls = byContact.get(row.contactId);
    if (!urls) byContact.set(row.contactId, [url]);
    else if (!urls.includes(url)) urls.push(url);
  }
  return byContact;
}

// One contact by id, for incremental checks

/**
 * Load and normalize one contact, for the incremental dedupe check after a
 * create or edit.
 */
export function normalizeContactById(
  scope: Scope,
  contactId: string,
): NormalizedContact | null {
  const raw = sqlite
    .prepare(
      `SELECT id, name, firstName, lastName, company, role, location, industry, headline, about, preferences
       FROM contacts WHERE id = ? AND ownerId = ?`,
    )
    .get(contactId, scope.ownerId) as RawContactRow | undefined;

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

/**
 * The scope a background path uses when all it has is a contact id. A
 * fire-and-forget embedding or a debounced dedupe check has no request behind
 * it, so the owner comes from the row, not from the async context, which a
 * stream or a timer can lose. Null when the contact is gone, which every caller
 * treats as nothing to do. `incrementalDedupeCheck` takes its scope from here
 * and opens a `runWithContext` around the rest of the check.
 */
export function scopeOfContact(contactId: string): Scope | null {
  const row = sqlite
    .prepare("SELECT ownerId FROM contacts WHERE id = ?")
    .get(contactId) as { ownerId: string } | undefined;
  return row ? scopeForOwnerId(row.ownerId) : null;
}
