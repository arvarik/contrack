/**
 * The free-text match score the Network list and the map both rank by: an
 * exact name 100, a name prefix 50, a name substring 30, and 10 for each of
 * company, role, location, industry, tag, email and phone.
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

/** How well a contact matches a query: 0 for no match, higher for closer. */
export function scoreContactMatch(
  contact: MatchableContact,
  rawQuery: string,
): number {
  if (!rawQuery.trim()) return 0;

  const q = rawQuery.toLowerCase().trim();
  const cleanPhoneQuery = normalizePhone(q);
  let score = 0;

  const nameMatch = contact.name.toLowerCase();
  if (nameMatch === q) {
    score += 100;
  } else if (nameMatch.startsWith(q)) {
    score += 50;
  } else if (nameMatch.includes(q)) {
    score += 30;
  }

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

  // Digits only, compared both ways, so "+15551234567" finds "(555) 123-4567"
  // despite the country code.
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
