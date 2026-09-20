/**
 * ContactActionsMenu: the kebab at the end of the name row in the contact
 * header.
 *
 * The header had a palette button and an archive button at the same rank as
 * the name, and delete in a kebab. None of them is something a person does
 * every visit, so they all live here now, in one menu built on `ActionMenu`:
 *
 * 1. Change colour, which opens the colour picker under this button.
 * 2. Change avatar.
 * 3. Copy basic details and Copy full details.
 * 4. Archive or Unarchive.
 * 5. Delete, last and on its own surface tone.
 *
 * The colour picker renders in the same positioned wrapper as the button, so
 * it opens under it and Escape can hand focus back to it.
 */
import { useCallback, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  ImageIcon,
  Palette,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Contact } from "../../../types";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
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

type ContactActionsMenuProps = Pick<
  ProfileHeaderProps,
  | "contact"
  | "onDelete"
  | "onOpenAvatarPicker"
  | "archiveContact"
  | "unarchiveContact"
  | "updateContact"
>;

export const ContactActionsMenu = ({
  contact,
  onDelete,
  onOpenAvatarPicker,
  archiveContact,
  unarchiveContact,
  updateContact,
}: ContactActionsMenuProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);

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
    {
      id: "avatar",
      label: "Change avatar",
      icon: ImageIcon,
      onSelect: onOpenAvatarPicker,
    },
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
