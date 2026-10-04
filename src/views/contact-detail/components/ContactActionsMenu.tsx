/**
 * ContactActionsMenu: the kebab at the end of the name row in the contact
 * header.
 *
 * The header had a palette button and an archive button at the same rank as
 * the name, and delete in a kebab. None of them is something a person does
 * every visit, so they all live here now, in one menu built on `ActionMenu`:
 *
 * 1. Change colour, which opens the colour picker under this button.
 * 2. Enrich contact and Enrich deeply, which research this one contact on
 *    the web at the Standard or the Deep depth. Each row's hint is the time
 *    a contact takes.
 * 3. Copy basic details and Copy full details.
 * 4. Share contact, which hands the contact's card (a vCard) to the phone's
 *    share sheet, so it goes to Messages, Mail or the address book. A
 *    browser that cannot share a file downloads the card instead.
 * 5. Archive or Unarchive.
 * 6. Delete, last and on its own surface tone.
 *
 * The enrich rows start the same background run as the Enrichment settings
 * page, for one contact (`startSearch` in `AISearchContext`). They ask for
 * no confirmation, because one contact is one request: the progress panel
 * opens at the bottom right, and the person keeps working. They are not
 * there when AI assistance is off or for a ghost, which has nothing yet to
 * search from. While a start is on its way, or while the running batch
 * still has a job for this contact, they read "Enriching…" and are
 * disabled, so a second press cannot queue the same contact twice. The lock
 * another account holds comes back as a toast, since the menu has closed
 * and has no page to say it on.
 *
 * Change avatar was here. It is the pencil on the avatar now, beside the
 * thing it changes (`ProfileHeader`).
 *
 * The colour picker renders in the same positioned wrapper as the button, so
 * it opens under it and Escape can hand focus back to it.
 */
import { useCallback, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
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
import { VibePickerPopover } from "./VibePickerPopover";
import type { ProfileHeaderProps } from "./ProfileHeader";

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

/**
 * Shares the contact as a vCard file, or downloads the file.
 *
 * 1. The phone's share sheet takes the file when the browser says it can
 *    (`navigator.canShare` with `files`). The menu runs this in the tap's
 *    own handler, so the browser still counts the tap as the reason.
 * 2. A closed sheet is a choice and does nothing more. Another refusal, or
 *    a browser with no file sharing (most desktops), downloads the file.
 */
async function shareContactCard(contact: Contact): Promise<void> {
  const file = new File([buildVCard(contact)], vCardFileName(contact.name), {
    type: "text/vcard",
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: contact.name });
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

  const copy = (text: string, success: string) => {
    copyToClipboard(text).then(
      () => toast.success(success),
      () => toast.error(CLIPBOARD_DENIED),
    );
  };

  const failed = (err: Error) =>
    toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);

  const toggleArchive = () => {
    if (contact.isArchived) {
      unarchiveContact(contact.id, {
        onSuccess: () => toast.success(`${contact.name} restored to network`),
        onError: failed,
      });
    } else {
      archiveContact(contact.id, {
        onSuccess: () => toast.success(`${contact.name} archived`),
        onError: failed,
      });
    }
  };

  const items: ActionMenuItem[] = [
    {
      id: "colour",
      label: "Change colour",
      icon: Palette,
      onSelect: () => setPickerOpen(true),
    },
    // An AI action about this contact, so it follows the contact's own look
    // and comes before the copies.
    ...(aiAllowed && !contact.isGhost
      ? [
          {
            id: "enrich",
            label: enriching ? "Enriching…" : "Enrich contact",
            icon: Sparkles,
            hint:
              enriching || !search.depthFiguresApply
                ? undefined
                : depthTime("standard"),
            speakHint: true,
            disabled: enriching,
            onSelect: () =>
              search.startSearch([contact.id], {
                limitAs: "toast",
                depth: "standard",
              }),
          },
          {
            id: "enrich-deep",
            label: "Enrich deeply",
            icon: Sparkles,
            hint:
              enriching || !search.depthFiguresApply
                ? undefined
                : depthTime("deep"),
            speakHint: true,
            disabled: enriching,
            onSelect: () =>
              search.startSearch([contact.id], {
                limitAs: "toast",
                depth: "deep",
              }),
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
      label: "Share contact",
      icon: Share2,
      onSelect: () => void shareContactCard(contact),
    },
    {
      id: "archive",
      label: contact.isArchived ? "Unarchive" : "Archive",
      icon: contact.isArchived ? ArchiveRestore : Archive,
      onSelect: toggleArchive,
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
