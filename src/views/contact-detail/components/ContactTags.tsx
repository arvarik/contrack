/**
 * ContactTags: a contact's tags, with "+ tag", and the lists the contact is
 * in.
 *
 * In the wide layout the row sits in the header, under the meta line. In the
 * narrow layout the header is one short block, so the row moves to the top
 * of the Details tab. One component, so both places add and remove a tag the
 * same way, with the same undo.
 */
import React from "react";
import { toast } from "sonner";

import type { Contact, ContactUpdateData } from "../../../types";
import { cn } from "../../../lib/utils";
import { ChipInput, type Chip } from "./ChipInput";
import { ContactListsSection } from "./ContactListsSection";

export interface ContactTagsProps {
  contact: Contact;
  updateContact: {
    mutate: (args: { id: string; data: ContactUpdateData }) => void;
  };
  className?: string;
}

export const ContactTags = ({
  contact,
  updateContact,
  className,
}: ContactTagsProps) => {
  // Tags come from enrichment today, which is why they wear the AI colour.
  const tagChips: Chip[] = (contact.tags || []).map((t) => ({
    id: t.id,
    label: t.tag,
    ai: true,
  }));

  const addTag = (text: string) => {
    updateContact.mutate({
      id: contact.id,
      data: {
        tags: [
          ...(contact.tags || []).map((t) => ({ tag: t.tag })),
          { tag: text },
        ],
      },
    });
  };

  const removeTag = (chip: Chip) => {
    const before = contact.tags || [];
    const after = before.filter((tag) => tag.id !== chip.id);
    updateContact.mutate({
      id: contact.id,
      data: { tags: after.map((tag) => ({ tag: tag.tag })) },
    });
    toast("Tag removed", {
      duration: 7000,
      action: {
        label: "Undo",
        onClick: () =>
          updateContact.mutate({
            id: contact.id,
            data: { tags: before.map((tag) => ({ tag: tag.tag })) },
          }),
      },
    });
  };

  // The row always shows, so "+ tag" is always there.
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      <ChipInput
        chips={tagChips}
        onAdd={addTag}
        onRemove={removeTag}
        noun="tag"
        addText="tag"
      />
      <ContactListsSection
        contactId={contact.id}
        contactLists={contact.lists || []}
      />
    </div>
  );
};
