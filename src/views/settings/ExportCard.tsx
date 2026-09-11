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
 */
import { Download, FileJson, FileSpreadsheet, Contact } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { CARD } from "../../lib/styles";

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

export const ExportCard = ({ show = true }: { show?: boolean }) =>
  !show ? null : (
    <div className={cn(CARD, "p-4 sm:p-6")}>
      <div className="flex items-start gap-3.5">
        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary">
          <Download className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-on-surface">
            Export your contacts
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
            Your data is yours. Every format below downloads only your own
            contacts, never anyone else&rsquo;s on this instance.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {FORMATS.map(({ href, icon: Icon, title, description }) => (
          <a
            key={href}
            href={href}
            download
            className={cn(
              "flex flex-col gap-1.5 p-3 rounded-xl bg-surface-container-low",
              "hover:bg-surface-container-high transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            )}
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
