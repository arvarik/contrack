// =============================================================================
// Export Service — full-database JSON export and flat CSV export
// =============================================================================
// No-lock-in escape hatch: everything the user owns, in one download.
// =============================================================================

import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
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
