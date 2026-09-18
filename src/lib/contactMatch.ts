/**
 * Shared contact matching and scoring logic.
 *
 * Extracted from useContactListFilters so both the Network list and the Map
 * use the same ranking algorithm for free-text search.
 *
 * Scoring priority:
 * - Exact name: +100
 * - Prefix name: +50
 * - Substring name: +30
 * - Company, Role, Location, Industry, Tag, Email, Phone: +10 each
 *
 * @module lib/contactMatch
 */

export interface MatchableContact {
  name: string;
  company?: string | null;
  role?: string | null;
  location?: string | null;
  industry?: string | null;
  tags?: ({ tag: string } | string)[] | null;
  emails?: { email: string }[] | null;
  phones?: { phone: string }[] | null;
}

const normalizePhone = (p: string) => p.replace(/\D/g, "");

/**
 * Score how well a contact matches a free-text search query.
 *
 * @returns 0 if no match, or a positive score where higher means a closer match.
 */
export function scoreContactMatch(
  contact: MatchableContact,
  rawQuery: string,
): number {
  if (!rawQuery.trim()) return 0;

  const q = rawQuery.toLowerCase().trim();
  const cleanPhoneQuery = normalizePhone(q);
  let score = 0;

  // --- High Priority (Name) ---
  const nameMatch = contact.name.toLowerCase();
  if (nameMatch === q) {
    score += 100;
  } else if (nameMatch.startsWith(q)) {
    score += 50;
  } else if (nameMatch.includes(q)) {
    score += 30;
  }

  // --- Medium Priority (Company, Role, Location, Industry) ---
  if (contact.company && contact.company.toLowerCase().includes(q)) {
    score += 10;
  }
  if (contact.role && contact.role.toLowerCase().includes(q)) {
    score += 10;
  }
  if (contact.location && contact.location.toLowerCase().includes(q)) {
    score += 10;
  }
  if (contact.industry && contact.industry.toLowerCase().includes(q)) {
    score += 10;
  }

  // --- Details match (Tags, Emails, Phones) ---
  if (contact.tags) {
    const tagMatch = contact.tags.some((t) =>
      (typeof t === "string" ? t : t.tag).toLowerCase().includes(q),
    );
    if (tagMatch) score += 10;
  }

  if (contact.emails) {
    const emailMatch = contact.emails.some((e) =>
      e.email.toLowerCase().includes(q),
    );
    if (emailMatch) score += 10;
  }

  // Phone numbers — normalize both the query and stored numbers to digits only,
  // then check in both directions to handle country code mismatches
  // (e.g. query "+15551234567" should match stored "(555) 123-4567")
  if (cleanPhoneQuery && contact.phones) {
    const phoneMatch = contact.phones.some((p) => {
      const normalized = normalizePhone(p.phone);
      return (
        normalized.length > 0 &&
        (normalized.includes(cleanPhoneQuery) ||
          cleanPhoneQuery.includes(normalized))
      );
    });
    if (phoneMatch) score += 10;
  }

  return score;
}
