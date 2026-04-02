import { sqlite } from "./db.ts";
import crypto from "crypto";

/** Map request body to contacts table columns. Always stamps updatedAt. */
export function buildContactUpdate(body: Record<string, unknown>) {
  const fields = [
    'name', 'firstName', 'lastName', 'headline', 'role', 'company',
    'location', 'birthday', 'preferences', 'avatarUrl', 'cadenceDays',
    'lastContactedAt', 'nextFollowUpAt', 'themeColor', 'about',
    'pronouns', 'industry', 'website',
  ] as const;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const f of fields) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  return update;
}

/** JOIN all child tables onto a flat contact row to produce the hydrated API shape. */
export function hydrateContact(contact: any): any {
  if (!contact) return contact;
  return {
    ...contact,
    emails: sqlite.prepare("SELECT id, email, label, isPrimary, source FROM contact_emails WHERE contactId = ? ORDER BY isPrimary DESC").all(contact.id).map((e: any) => ({ ...e, isPrimary: !!e.isPrimary })),
    phones: sqlite.prepare("SELECT id, phone, label, isPrimary, source FROM contact_phones WHERE contactId = ? ORDER BY isPrimary DESC").all(contact.id).map((p: any) => ({ ...p, isPrimary: !!p.isPrimary })),
    socialLinks: sqlite.prepare("SELECT id, platform, url, handle, source FROM contact_social_links WHERE contactId = ?").all(contact.id),
    education: sqlite.prepare("SELECT id, school, degree, fieldOfStudy, startDate, endDate, description FROM contact_education WHERE contactId = ?").all(contact.id),
    experience: sqlite.prepare("SELECT id, company, role, startDate, endDate, isCurrent, description, location FROM contact_experience WHERE contactId = ?").all(contact.id).map((e: any) => ({ ...e, isCurrent: !!e.isCurrent })),
    sources: sqlite.prepare("SELECT id, platform, externalId, connectedOn, importedAt FROM contact_sources WHERE contactId = ?").all(contact.id),
    tags: sqlite.prepare("SELECT id, tag FROM contact_tags WHERE contactId = ?").all(contact.id),
    addresses: sqlite.prepare("SELECT id, address, label, isPrimary, source FROM contact_addresses WHERE contactId = ? ORDER BY isPrimary DESC").all(contact.id).map((a: any) => ({ ...a, isPrimary: !!a.isPrimary })),
    lists: sqlite.prepare(`
      SELECT l.id, l.name, l.icon FROM lists l
      JOIN list_members lm ON l.id = lm.listId
      WHERE lm.contactId = ?
      ORDER BY l.sortOrder ASC
    `).all(contact.id),
  };
}

export function detectPlatformFromUrl(url: string): string {
  const l = url.toLowerCase();
  if (l.includes('linkedin.com')) return 'linkedin';
  if (l.includes('facebook.com') || l.includes('fb.com')) return 'facebook';
  if (l.includes('twitter.com') || l.includes('x.com')) return 'twitter';
  if (l.includes('github.com')) return 'github';
  if (l.includes('instagram.com')) return 'instagram';
  return 'other';
}

export function extractHandleFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last && last !== 'in' && last !== 'profile.php' ? last : null;
  } catch { return null; }
}

/** Insert child records (emails, phones, socialLinks, education, experience, tags, sources) inside a transaction. */
export function insertChildRecords(contactId: string, body: any, sourceName = 'manual'): void {
  if (Array.isArray(body.emails)) {
    for (let i = 0; i < body.emails.length; i++) {
      const e = body.emails[i];
      const email = (typeof e === 'string' ? e : e.email)?.trim();
      if (!email) continue;
      sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId, email,
        (typeof e === 'object' ? e.label : 'personal') || 'personal',
        typeof e === 'object' ? (e.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
        sourceName,
      );
    }
  }
  if (Array.isArray(body.phones)) {
    for (let i = 0; i < body.phones.length; i++) {
      const p = body.phones[i];
      const phone = (typeof p === 'string' ? p : p.phone)?.trim();
      if (!phone) continue;
      sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId, phone,
        (typeof p === 'object' ? p.label : 'mobile') || 'mobile',
        typeof p === 'object' ? (p.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
        sourceName,
      );
    }
  }
  if (Array.isArray(body.socialLinks)) {
    for (const sl of body.socialLinks) {
      const url = (typeof sl === 'string' ? sl : sl.url)?.trim();
      if (!url) continue;
      const platform = typeof sl === 'object' && sl.platform ? sl.platform : detectPlatformFromUrl(url);
      sqlite.prepare("INSERT INTO contact_social_links (id, contactId, platform, url, handle, source) VALUES (?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId, platform, url,
        typeof sl === 'object' ? sl.handle || extractHandleFromUrl(url) : extractHandleFromUrl(url),
        sourceName,
      );
    }
  }
  if (Array.isArray(body.education)) {
    for (const edu of body.education) {
      if (!edu?.school) continue;
      sqlite.prepare("INSERT INTO contact_education (id, contactId, school, degree, fieldOfStudy, startDate, endDate, description, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId,
        edu.school, edu.degree || null, edu.fieldOfStudy || null,
        edu.startDate || null, edu.endDate || null,
        edu.description || null, sourceName,
      );
    }
  }
  if (Array.isArray(body.experience)) {
    for (const exp of body.experience) {
      if (!exp?.company) continue;
      sqlite.prepare("INSERT INTO contact_experience (id, contactId, company, role, startDate, endDate, isCurrent, description, location, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId,
        exp.company, exp.role || null,
        exp.startDate || null, exp.endDate || null,
        exp.isCurrent ? 1 : 0, exp.description || null,
        exp.location || null, sourceName,
      );
    }
  }
  if (Array.isArray(body.tags)) {
    for (const tag of body.tags) {
      const val = (typeof tag === 'string' ? tag : tag.tag)?.trim();
      if (!val) continue;
      sqlite.prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)").run(crypto.randomUUID(), contactId, val);
    }
  }
  if (Array.isArray(body.sources)) {
    for (const src of body.sources) {
      const platform = typeof src === 'string' ? src : src.platform;
      if (!platform) continue;
      sqlite.prepare("INSERT INTO contact_sources (id, contactId, platform, externalId, connectedOn, rawData) VALUES (?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId, platform,
        typeof src === 'object' ? src.externalId || null : null,
        typeof src === 'object' ? src.connectedOn || null : null,
        typeof src === 'object' ? src.rawData || null : null,
      );
    }
  }
  if (Array.isArray(body.addresses)) {
    for (let i = 0; i < body.addresses.length; i++) {
      const a = body.addresses[i];
      const address = (typeof a === 'string' ? a : a.address)?.trim();
      if (!address) continue;
      sqlite.prepare("INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), contactId, address,
        (typeof a === 'object' ? a.label : 'home') || 'home',
        typeof a === 'object' ? (a.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
        sourceName,
      );
    }
  }
}

/** Classic DP Levenshtein distance. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalized 0→1 similarity score (1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;
  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(la, lb) / maxLen;
}

/** Strip all non-digits. Returns the last 10 digits to normalize country-code variants. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
