// =============================================================================
// Export Service — full-database JSON export and flat CSV export
// =============================================================================
// No-lock-in escape hatch: everything the user owns, in one download.
// =============================================================================

import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
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

/** Everything, hydrated — including archived and trashed rows (flagged). */
export function buildFullExport(): FullExport {
  const contacts = contactRepo.hydrateMany(
    sqlite.prepare("SELECT * FROM contacts ORDER BY addedAt ASC").all(),
  );
  const interactions = sqlite
    .prepare("SELECT * FROM interactions ORDER BY date ASC")
    .all();
  const lists = sqlite.prepare("SELECT * FROM lists ORDER BY sortOrder").all();
  const listMembers = sqlite.prepare("SELECT * FROM list_members").all();
  const actionItems = sqlite
    .prepare("SELECT * FROM action_items ORDER BY dueAt ASC")
    .all();
  const mergeLog = sqlite
    .prepare("SELECT * FROM dedupe_merge_log ORDER BY mergedAt ASC")
    .all();

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

/** Flat contacts CSV (active + archived; trash excluded). */
export function buildContactsCsv(): string {
  const contacts = contactRepo.hydrateMany(
    sqlite
      .prepare(
        "SELECT * FROM contacts WHERE deletedAt IS NULL ORDER BY name COLLATE NOCASE ASC",
      )
      .all(),
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
