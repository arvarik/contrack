// =============================================================================
// Export Service — JSON, CSV and vCard
// =============================================================================
// No-lock-in escape hatch: everything the user owns, in one download.
//
// Three formats, because they answer three different questions.
//
// JSON is the complete one: every row, every relation, the interactions and
// the merge log. Nothing else can reconstruct this instance.
//
// CSV is the one a spreadsheet opens. It is flat by definition, so a contact
// with three emails becomes one cell with three emails in it.
//
// vCard is the one another address book opens. It is the only export that
// goes back in anywhere else, and the only one this app can read again — the
// same `shared/vcard.ts` writes it here and parses it in the import modal, so
// a file exported and re-imported is the same contact rather than nearly.
// =============================================================================

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
 * One account's data, hydrated, including its archived and trashed rows.
 *
 * Every table filters by the caller. `list_members` is the one that cannot:
 * it carries no `ownerId`, so it reaches the owner through its list. Filtering
 * it by `contactId` instead would drop a membership whose list belongs to the
 * caller but whose contact row is already gone.
 *
 * Phase 3's admin offboarding export calls this with `scopeForOwnerId(id)`.
 */
export function buildFullExport(scope: Scope): FullExport {
  const owner = scope.ownerId;
  const contacts = contactRepo.hydrateMany(
    sqlite
      .prepare("SELECT * FROM contacts WHERE ownerId = ? ORDER BY addedAt ASC")
      .all(owner),
  );
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

/** RFC-4180 CSV escaping: quote when needed, double embedded quotes. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One account's flat contacts CSV (active + archived; trash excluded). */
export function buildContactsCsv(scope: Scope): string {
  const contacts = contactRepo.hydrateMany(
    sqlite
      .prepare(
        `SELECT * FROM contacts
          WHERE ownerId = ? AND deletedAt IS NULL
          ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(scope.ownerId),
  );

  const header = [
    "Name",
    "First Name",
    "Last Name",
    "Company",
    "Role",
    "Location",
    "Industry",
    "Website",
    "Emails",
    "Phones",
    "Tags",
    "Archived",
    "Added At",
    "Last Contacted At",
  ];

  const rows = contacts.map((c) =>
    [
      c.name,
      c.firstName,
      c.lastName,
      c.company,
      c.role,
      c.location,
      c.industry,
      c.website,
      (c.emails ?? []).map((e) => e.email).join("; "),
      (c.phones ?? []).map((p) => p.phone).join("; "),
      (c.tags ?? []).map((t) => t.tag).join("; "),
      c.isArchived ? "yes" : "no",
      c.addedAt,
      c.lastContactedAt,
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";
}

/**
 * One account's contacts as a vCard file.
 *
 * Same rows as the CSV: active and archived, trash excluded. A trashed contact
 * is one the person deleted, and handing it back in the file they are taking
 * to another address book undoes their decision.
 *
 * Ghosts are excluded, and that is the one place this differs from the CSV. A
 * ghost is a name Contrack extracted from a note and has no card of its own to
 * write — no email, no phone, often no surname. Exporting a thousand of them
 * into somebody's phone is not migration.
 */
export function buildContactsVcf(scope: Scope): string {
  const contacts = contactRepo.hydrateMany(
    sqlite
      .prepare(
        `SELECT * FROM contacts
          WHERE ownerId = ? AND deletedAt IS NULL AND isGhost = 0
          ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(scope.ownerId),
  );

  return serializeVCards(contacts.map(toVCardInput));
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
