/**
 * ContactActionsMenu: the kebab at the end of the name row in the contact
 * header. It holds what a person does not do every visit: Change color,
 * Enrich contact and Enrich deeply, the two copies, Share contact, Archive,
 * and Delete last.
 *
 * The enrich rows start the same background run as the Enrichment settings
 * page (`startSearch`), with no confirmation: one contact is one request.
 * They are hidden when AI assistance is off and for a ghost, which has
 * nothing to search from. While this contact is enriching they are disabled,
 * so a second press cannot queue it twice. A lock that another account holds
 * comes back as a toast, since the menu has closed.
 *
 * The color picker renders in the same positioned wrapper as the button, so
 * it opens under it and Escape can hand focus back to it.
 */
import { useCallback, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  Palette,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Contact } from "../../../types";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { buildVCard, vCardFileName } from "../../../lib/contactLinks";
import { isEnriching, useAISearch } from "../../../contexts/AISearchContext";
import { depthTime } from "../../../lib/researchDepth";
import { useAiAllowed } from "../../../hooks/useAiAllowed";
import { aiSetupLine, useBlockedAi } from "../../../hooks/useAiSetup";
import { withUndo } from "../../../lib/undoToast";
import { VibePickerPopover } from "./VibePickerPopover";
import type { ProfileHeaderProps } from "./ProfileHeader";
import { errorText } from "../../../lib/utils";

/** Name, emails and phones: enough to reach the person. */
function basicDetailsText(contact: Contact): string {
  const textChunks = [`Name: ${contact.name}`];
  if (contact.emails?.length)
    textChunks.push(`Email: ${contact.emails.map((e) => e.email).join(", ")}`);
  if (contact.phones?.length)
    textChunks.push(`Phone: ${contact.phones.map((p) => p.phone).join(", ")}`);
  return textChunks.join("\n");
}

/** Every plain fact on the contact, one per line. */
function fullDetailsText(contact: Contact): string {
  const textChunks = [`Name: ${contact.name}`];
  if (contact.role) textChunks.push(`Role: ${contact.role}`);
  if (contact.company) textChunks.push(`Company: ${contact.company}`);
  if (contact.emails?.length)
    textChunks.push(`Email: ${contact.emails.map((e) => e.email).join(", ")}`);
  if (contact.phones?.length)
    textChunks.push(`Phone: ${contact.phones.map((p) => p.phone).join(", ")}`);
  if (contact.birthday) textChunks.push(`Birthday: ${contact.birthday}`);
  if (contact.addresses?.length) {
    textChunks.push(
      `Location: ${contact.addresses.map((a) => a.address).join(" | ")}`,
    );
  } else if (contact.location) {
    textChunks.push(`Location: ${contact.location}`);
  }
  return textChunks.join("\n");
}

/** True when the browser has a share sheet. Most desktops have none. */
const hasShareSheet = () => typeof navigator.share === "function";

/** The card as text: the name, then each phone and each email, by line. */
function cardText(contact: Contact): string {
  return [
    contact.name,
    ...(contact.phones ?? []).map((p) => p.phone),
    ...(contact.emails ?? []).map((e) => e.email),
  ]
    .filter((line) => line.trim())
    .join("\n");
}

/**
 * Shares the contact's vCard, or downloads it.
 *
 * The share sheet takes the file where `navigator.canShare` allows it
 * (Safari on an iPhone). Chrome on Android lists no `.vcf` type, so its
 * sheet gets the card as text. With no sheet, or on a refusal other than a
 * closed sheet, the file downloads. The menu calls this in the tap's own
 * handler, so the browser counts the tap as the reason for the sheet.
 */
async function shareContactCard(contact: Contact): Promise<void> {
  const file = new File([buildVCard(contact)], vCardFileName(contact.name), {
    type: "text/vcard",
  });
  if (hasShareSheet()) {
    try {
      await navigator.share(
        navigator.canShare?.({ files: [file] })
          ? { files: [file], title: contact.name }
          : { text: cardText(contact), title: contact.name },
      );
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Later, not now: Safari reads the file after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast.success("Contact card downloaded");
}

type ContactActionsMenuProps = Pick<
  ProfileHeaderProps,
  | "contact"
  | "onDelete"
  | "archiveContact"
  | "unarchiveContact"
  | "archivePending"
  | "updateContact"
>;

export const ContactActionsMenu = ({
  contact,
  onDelete,
  archiveContact,
  unarchiveContact,
  archivePending,
  updateContact,
}: ContactActionsMenuProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const aiAllowed = useAiAllowed();
  const search = useAISearch();
  const enriching = isEnriching(search, contact.id);
  // No model or no web search: a press says why and where an admin fixes it.
  const blocked = useBlockedAi("research");
  const enrich = (depth: "standard" | "deep") =>
    blocked
      ? toast.error(`Could not enrich. ${aiSetupLine(blocked)}`, {
          description: blocked.fix?.label,
        })
      : search.startSearch([contact.id], { limitAs: "toast", depth });

  const copy = (text: string, success: string) => {
    copyToClipboard(text).then(
      () => toast.success(success),
      () => toast.error(CLIPBOARD_DENIED),
    );
  };

  const failed = (what: string) => (err: Error) =>
    toast.error(`Could not ${what}: ${errorText(err)}`);

  // Each way, with Undo, in the words the Network list's Archive uses.
  const archive = () =>
    archiveContact(contact.id, {
      onSuccess: () =>
        toast.success(`Archived ${contact.name}`, withUndo(unarchive)),
      onError: failed("archive"),
    });
  const unarchive = () =>
    unarchiveContact(contact.id, {
      onSuccess: () =>
        toast.success(`${contact.name} is back in Network`, withUndo(archive)),
      onError: failed("unarchive"),
    });

  // The share row says what the browser can do: share, or only save a file.
  const shareSheet = hasShareSheet();
  const items: ActionMenuItem[] = [
    {
      id: "color",
      label: "Change color",
      icon: Palette,
      onSelect: () => setPickerOpen(true),
    },
    ...(aiAllowed && !contact.isGhost
      ? [
          {
            id: "enrich",
            label: enriching ? "Enriching…" : "Enrich contact",
            icon: Sparkles,
            hint: blocked
              ? "Needs AI"
              : enriching || !search.depthFiguresApply
                ? undefined
                : depthTime("standard"),
            speakHint: true,
            disabled: enriching,
            onSelect: () => enrich("standard"),
          },
          {
            id: "enrich-deep",
            label: "Enrich deeply",
            icon: Sparkles,
            hint: blocked
              ? "Needs AI"
              : enriching || !search.depthFiguresApply
                ? undefined
                : depthTime("deep"),
            speakHint: true,
            disabled: enriching,
            onSelect: () => enrich("deep"),
          },
        ]
      : []),
    {
      id: "copy-basic",
      label: "Copy basic details",
      icon: Copy,
      onSelect: () => copy(basicDetailsText(contact), "Basic details copied"),
    },
    {
      id: "copy-full",
      label: "Copy full details",
      icon: Copy,
      onSelect: () => copy(fullDetailsText(contact), "All details copied"),
    },
    {
      id: "share",
      label: shareSheet ? "Share contact" : "Save contact card",
      icon: shareSheet ? Share2 : Download,
      onSelect: () => void shareContactCard(contact),
    },
    {
      id: "archive",
      label: contact.isArchived ? "Unarchive" : "Archive",
      icon: contact.isArchived ? ArchiveRestore : Archive,
      onSelect: contact.isArchived ? unarchive : archive,
      disabled: archivePending,
    },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      onSelect: onDelete,
      danger: true,
    },
  ];

  return (
    <div className="relative inline-flex">
      <ActionMenu label="Contact actions" items={items} triggerRef={trigger} />
      <VibePickerPopover
        open={pickerOpen}
        onClose={closePicker}
        currentVibeId={contact.themeColor}
        onSelect={(vibeId) =>
          updateContact({ id: contact.id, data: { themeColor: vibeId } })
        }
        returnFocusTo={trigger}
      />
    </div>
  );
};
