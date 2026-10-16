/**
 * Export in three formats, one per use: vCard for another address book (the
 * only one that imports back, losslessly), CSV for a spreadsheet, and JSON
 * for everything this app holds.
 *
 * A plain `<a download>`, not fetch and blob: the session cookie travels with
 * a navigation, and a blob would hold the whole export in memory.
 */
import { FileJson, FileSpreadsheet, Contact } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { SETTINGS_CARD } from "./layout";

const FORMATS: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    href: "/api/export/vcard",
    icon: Contact,
    title: "vCard (.vcf)",
    description:
      "For Apple Contacts, Google Contacts, Outlook and phones. Re-imports losslessly",
  },
  {
    href: "/api/export/csv",
    icon: FileSpreadsheet,
    title: "Spreadsheet (.csv)",
    description:
      "One row per contact for Excel or Sheets, with emails, phones and tags in single cells",
  },
  {
    href: "/api/export/json",
    icon: FileJson,
    title: "Everything (.json)",
    description:
      "Full backup of your contacts, interactions, lists, follow-ups and merges",
  },
];

export const ExportCard = () => (
  <div className={cn(SETTINGS_CARD, "space-y-4")}>
    <p className="text-sm text-on-surface-variant text-pretty">
      Your data is yours. Each export holds your own contacts and activity only
    </p>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {FORMATS.map(({ href, icon: Icon, title, description }) => (
        <a
          key={href}
          href={href}
          download
          className="lift state-layer flex flex-col gap-1.5 p-3.5 rounded-xl bg-surface-container-low"
        >
          <span className="flex items-center gap-2 font-bold text-sm text-on-surface">
            <Icon className="w-4 h-4 text-primary shrink-0" aria-hidden />
            {title}
          </span>
          <span className="text-xs text-on-surface-variant text-pretty">
            {description}
          </span>
        </a>
      ))}
    </div>
  </div>
);
