/**
 * ExportCard — take everything with you.
 *
 * Three formats were reachable only by typing a URL, which makes "no lock-in"
 * a claim rather than a feature. They answer three different questions, so all
 * three are offered rather than one being chosen for the person:
 *
 *   vCard  another address book. The only format that also comes back IN, and
 *          the same module writes and reads it, so a round trip is lossless.
 *   CSV    a spreadsheet. Flat by definition: three emails become one cell.
 *   JSON   this app. Interactions, lists, action items and the merge log, which
 *          nothing else can carry.
 *
 * A plain `<a download>` rather than a fetch-and-blob: the browser already
 * knows how to save a file the server names, and the session cookie travels
 * with a navigation. Building a blob would mean holding a whole export in
 * memory to hand it to the same download the anchor performs.
 *
 * Each format is a tile that downloads its file as a whole, so it lifts on
 * hover (`lift`, "Elevation" in `.agent/STYLE.md`).
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
      "Opens in Apple Contacts, Google Contacts, Outlook, and any phone. Import it back here at any time.",
  },
  {
    href: "/api/export/csv",
    icon: FileSpreadsheet,
    title: "Spreadsheet (.csv)",
    description:
      "One row per contact, for a spreadsheet. Emails, phones and tags are joined into single cells.",
  },
  {
    href: "/api/export/json",
    icon: FileJson,
    title: "Everything (.json)",
    description:
      "Every contact, interaction, list, action item and merge. The complete copy.",
  },
];

export const ExportCard = () => (
  <div className={cn(SETTINGS_CARD, "space-y-4")}>
    <p className="text-sm text-on-surface-variant text-pretty">
      Your data is yours. Each file holds your own contacts only, never anyone
      else&rsquo;s on this instance.
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
