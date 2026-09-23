/**
 * ContactActionsMenu: the kebab at the end of the name row in the contact
 * header.
 *
 * The header had a palette button and an archive button at the same rank as
 * the name, and delete in a kebab. None of them is something a person does
 * every visit, so they all live here now, in one menu built on `ActionMenu`:
 *
 * 1. Change colour, which opens the colour picker under this button.
 * 2. Enrich contact, which researches this one contact on the web.
 * 3. Copy basic details and Copy full details.
 * 4. Archive or Unarchive.
 * 5. Delete, last and on its own surface tone.
 *
 * Enrich contact starts the same background run as the Enrichment settings
 * page, for one contact (`startSearch` in `AISearchContext`). It asks for
 * no confirmation, because one contact is one request: the start toasts,
 * the progress panel opens at the bottom right, and the person keeps
 * working. The item is not there when AI assistance is off or for a ghost,
 * which has nothing yet to search from. While a start is on its way, or
 * while the running batch still has a job for this contact, it reads
 * "Enriching…" and is disabled, so a second press cannot queue the same
 * contact twice. A limit (a cooldown, or the lock another account holds)
 * comes back as a toast, since the menu has closed and has no page to say
 * it on.
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
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { AISearchJobStatus, Contact } from "../../../types";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { useAISearch } from "../../../contexts/AISearchContext";
import { useAiAllowed } from "../../../hooks/useAiAllowed";
import { VibePickerPopover } from "./VibePickerPopover";
import type { ProfileHeaderProps } from "./ProfileHeader";

/** Name, emails and phones: enough to reach the person. */
export function basicDetailsText(contact: Contact): string {
  const textChunks = [`Name: ${contact.name}`];
  if (contact.emails?.length)
    textChunks.push(`Email: ${contact.emails.map((e) => e.email).join(", ")}`);
  if (contact.phones?.length)
    textChunks.push(`Phone: ${contact.phones.map((p) => p.phone).join(", ")}`);
  return textChunks.join("\n");
}

/** Every plain fact on the contact, one per line. */
export function fullDetailsText(contact: Contact): string {
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

/** A job that has not finished yet: waiting, searching, or merging. */
const UNFINISHED: ReadonlySet<AISearchJobStatus> = new Set([
  "queued",
  "searching",
  "merging",
]);

type ContactActionsMenuProps = Pick<
  ProfileHeaderProps,
  | "contact"
  | "onDelete"
  | "archiveContact"
  | "unarchiveContact"
  | "updateContact"
>;

export const ContactActionsMenu = ({
  contact,
  onDelete,
  archiveContact,
  unarchiveContact,
  updateContact,
}: ContactActionsMenuProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const aiAllowed = useAiAllowed();
  const { startSearch, isStarting, batch } = useAISearch();

  // This contact is being enriched: a start is on its way, or the running
  // batch still has an unfinished job for it.
  const enriching =
    isStarting ||
    (batch?.status === "processing" &&
      batch.jobs.some(
        (job) => job.contactId === contact.id && UNFINISHED.has(job.status),
      ));

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
      unarchiveContact.mutate(contact.id, {
        onSuccess: () => toast.success(`${contact.name} restored to network`),
        onError: failed,
      });
    } else {
      archiveContact.mutate(contact.id, {
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
            disabled: enriching,
            onSelect: () => startSearch([contact.id], { limitAs: "toast" }),
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
      id: "archive",
      label: contact.isArchived ? "Unarchive" : "Archive",
      icon: contact.isArchived ? ArchiveRestore : Archive,
      onSelect: toggleArchive,
      disabled: archiveContact.isPending || unarchiveContact.isPending,
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
          updateContact.mutate({ id: contact.id, data: { themeColor: vibeId } })
        }
        returnFocusTo={trigger}
      />
    </div>
  );
};
