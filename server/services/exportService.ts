// Export: everything the user owns, in one download, in three formats for three
// questions.
// - JSON is complete: every row, relation, interaction and the merge log.
//   Nothing else can rebuild this instance.
// - CSV is what a spreadsheet opens. It is flat, so three emails share one
//   cell.
// - vCard is what another address book opens, and the only export this app
//   reads back: `shared/vcard.ts` writes it here and parses it in the import
//   modal, so an exported and re-imported contact is the same contact.

import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { serializeVCards, type VCardInput } from "../../shared/vcard.ts";
import type { Scope } from "../tenancy/scope.ts";
import type { HydratedContact } from "../repositories/types.ts";

export interface FullExport {
  exportedAt: string;
  version: 1;
  contacts: HydratedContact[];
  interactions: unknown[];
  lists: unknown[];
  listMembers: unknown[];
  actionItems: unknown[];
  mergeLog: unknown[];
}

/**
 * The account name in a download filename: two accounts make two files a day,
 * and a date alone would let the second overwrite the first in the downloads
 * folder. Anything outside `[A-Za-z0-9._-]` is stripped, because the value
 * lands in a quoted `Content-Disposition` header, where a stray quote would end
 * the filename.
 */
export function exportFileSlug(username: string | undefined): string {
  const slug = (username ?? "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  return slug || "account";
}

/**
 * One account's data, hydrated, archived and trashed rows included. Every table
 * filters by the caller. `list_members` has no `ownerId`, so it reaches the
 * owner through its list; filtering by `contactId` instead would drop a
 * membership whose contact row is gone. The admin offboarding export calls this
 * with `scopeForOwnerId(id)`.
 */
export function buildFullExport(scope: Scope): FullExport {
  const owner = scope.ownerId;
  const contacts = contactRepo.hydrateMany(
    sqlite
      .prepare("SELECT * FROM contacts WHERE ownerId = ? ORDER BY addedAt ASC")
      .all(owner),
  );
  // Preserve import payloads and history provenance in the complete account export.
  // Normal contact responses omit rawData to keep list requests small.
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const sourceRows = sqlite
    .prepare(
      `SELECT s.* FROM contact_sources s JOIN contacts c ON c.id = s.contactId WHERE c.ownerId = ?`,
    )
    .all(owner) as (HydratedContact["sources"][number] & {
    contactId: string;
  })[];
  const experienceRows = sqlite
    .prepare(
      `SELECT e.* FROM contact_experience e JOIN contacts c ON c.id = e.contactId WHERE c.ownerId = ?`,
    )
    .all(owner) as (Omit<HydratedContact["experience"][number], "isCurrent"> & {
    contactId: string;
    isCurrent: number;
  })[];
  const educationRows = sqlite
    .prepare(
      `SELECT e.* FROM contact_education e JOIN contacts c ON c.id = e.contactId WHERE c.ownerId = ?`,
    )
    .all(owner) as (HydratedContact["education"][number] & {
    contactId: string;
  })[];
  for (const contact of contacts) {
    contact.sources = [];
    contact.experience = [];
    contact.education = [];
  }
  for (const { contactId, ...row } of sourceRows)
    byId.get(contactId)?.sources.push(row);
  for (const { contactId, ...row } of experienceRows)
    byId
      .get(contactId)
      ?.experience.push({ ...row, isCurrent: row.isCurrent === 1 });
  for (const { contactId, ...row } of educationRows)
    byId.get(contactId)?.education.push(row);
  const interactions = sqlite
    .prepare("SELECT * FROM interactions WHERE ownerId = ? ORDER BY date ASC")
    .all(owner);
  const lists = sqlite
    .prepare("SELECT * FROM lists WHERE ownerId = ? ORDER BY sortOrder")
    .all(owner);
  const listMembers = sqlite
    .prepare(
      `SELECT lm.* FROM list_members lm
         JOIN lists l ON l.id = lm.listId
        WHERE l.ownerId = ?`,
    )
    .all(owner);
  const actionItems = sqlite
    .prepare("SELECT * FROM action_items WHERE ownerId = ? ORDER BY dueAt ASC")
    .all(owner);
  const mergeLog = sqlite
    .prepare(
      "SELECT * FROM dedupe_merge_log WHERE ownerId = ? ORDER BY mergedAt ASC",
    )
    .all(owner);

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    contacts,
    interactions,
    lists,
    listMembers,
    actionItems,
    mergeLog,
  };
}

/**
 * A cell a spreadsheet runs as a formula: it starts with `=`, `+`, `-` or
 * `@`, or with a tab or carriage return that hides one of those.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: RFC 4180 escaping, quoted when needed, quotes doubled. Text
 * that would start a formula gets a leading `'`, which Excel, Numbers and
 * Google Sheets read as "this cell is text": a Google sync, an imported vCard
 * or AI research can put `=HYPERLINK(...)` in a company name, and the owner's
 * own export would run it on open. A phone number such as `+1 555` gets the
 * mark too, so it is not read as a sum. Numbers are left as they are.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The contacts both files write: active and archived, and not the Trash, ghosts
 * or merged-away rows (see `buildContactsVcf`).
 */
function exportableContacts(scope: Scope): HydratedContact[] {
  return contactRepo.hydrateMany(
    sqlite
      .prepare(
        `SELECT * FROM contacts
          WHERE ownerId = ? AND deletedAt IS NULL AND isGhost = 0
            AND canonicalId IS NULL
          ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(scope.ownerId),
  );
}

/** Each CSV column: its header, and how it reads one contact. */
const CSV_COLUMNS: [string, (c: HydratedContact) => unknown][] = [
  ["Name", (c) => c.name],
  ["First Name", (c) => c.firstName],
  ["Last Name", (c) => c.lastName],
  ["Company", (c) => c.company],
  ["Role", (c) => c.role],
  ["Location", (c) => c.location],
  ["Industry", (c) => c.industry],
  ["Website", (c) => c.website],
  ["Emails", (c) => (c.emails ?? []).map((e) => e.email).join("; ")],
  ["Phones", (c) => (c.phones ?? []).map((p) => p.phone).join("; ")],
  ["Addresses", (c) => (c.addresses ?? []).map((a) => a.address).join("; ")],
  ["Social Links", (c) => (c.socialLinks ?? []).map((l) => l.url).join("; ")],
  ["Birthday", (c) => c.birthday],
  ["About", (c) => c.about],
  ["Tags", (c) => (c.tags ?? []).map((t) => t.tag).join("; ")],
  ["Archived", (c) => (c.isArchived ? "yes" : "no")],
  ["Tracked", (c) => (c.isTracked ? "yes" : "no")],
  ["Cadence Days", (c) => c.cadenceDays],
  ["Tracked At", (c) => c.trackedAt],
  ["Added At", (c) => c.addedAt],
  ["Last Contacted At", (c) => c.lastContactedAt],
];

/**
 * One account's flat contacts CSV: the same rows as the vCard file (see
 * `buildContactsVcf`).
 */
export function buildContactsCsv(scope: Scope): string {
  const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(",");
  const rows = exportableContacts(scope).map((c) =>
    CSV_COLUMNS.map(([, read]) => csvCell(read(c))).join(","),
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * One account's contacts as a vCard file: active and archived contacts, and
 * not:
 * - the Trash: the person deleted those, and handing them back undoes the
 *   decision;
 * - ghosts: names extracted from notes, with no card to write (no email, no
 *   phone, often no surname);
 * - merged-away contacts: the kept contact holds both sides, and the other row
 *   exists only for undo, so it would write the same person twice.
 */
export function buildContactsVcf(scope: Scope): string {
  return serializeVCards(exportableContacts(scope).map(toVCardInput));
}

/** The fields of a contact that belong on a contact card. */
export function toVCardInput(contact: HydratedContact): VCardInput {
  return {
    name: contact.name,
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    role: contact.role,
    birthday: contact.birthday,
    about: contact.about,
    website: contact.website,
    emails: (contact.emails ?? []).map((e) => ({
      email: e.email,
      label: e.label,
      isPrimary: e.isPrimary,
    })),
    phones: (contact.phones ?? []).map((p) => ({
      phone: p.phone,
      label: p.label,
      isPrimary: p.isPrimary,
    })),
    addresses: (contact.addresses ?? []).map((a) => ({
      address: a.address,
      label: a.label,
      isPrimary: a.isPrimary,
    })),
    socialLinks: (contact.socialLinks ?? []).map((s) => ({
      platform: s.platform,
      url: s.url,
    })),
    tags: (contact.tags ?? []).map((t) => t.tag),
    updatedAt: contact.updatedAt,
  };
}
