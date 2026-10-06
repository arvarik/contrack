/**
 * ContactTags: a contact's tags, with "+ tag", and the lists the contact is
 * in.
 *
 * In the wide layout the row sits in the header, under the meta line. In the
 * narrow layout the header is one short block, so the row moves to the top
 * of the Details tab. One component, so both places add and remove a tag the
 * same way, with the same undo.
 */
import { showUndoToast } from "./Field";

import type { Contact, ContactUpdateData } from "../../../types";
import { cn } from "../../../lib/utils";
import { ChipInput, type Chip } from "./ChipInput";
import { ContactListsSection } from "./ContactListsSection";

interface ContactTagsProps {
  contact: Contact;
  updateContact: (args: { id: string; data: ContactUpdateData }) => void;
  className?: string;
}

export const ContactTags = ({
  contact,
  updateContact,
  className,
}: ContactTagsProps) => {
  // No AI colour: a tag records no source, and a person types, imports or
  // researches them alike. The AI colour means a model wrote this.
  const tagChips: Chip[] = (contact.tags || []).map((t) => ({
    id: t.id,
    label: t.tag,
  }));

  const addTags = (texts: string[]) => {
    updateContact({
      id: contact.id,
      data: {
        tags: [
          ...(contact.tags || []).map((t) => ({ tag: t.tag })),
          ...texts.map((tag) => ({ tag })),
        ],
      },
    });
  };

  const removeTag = (chip: Chip) => {
    const before = contact.tags || [];
    const after = before.filter((tag) => tag.id !== chip.id);
    updateContact({
      id: contact.id,
      data: { tags: after.map((tag) => ({ tag: tag.tag })) },
    });
    showUndoToast("Tag removed", () =>
      updateContact({
        id: contact.id,
        data: { tags: before.map((tag) => ({ tag: tag.tag })) },
      }),
    );
  };

  // The row always shows, so "+ tag" is always there.
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      <ChipInput
        chips={tagChips}
        onAdd={addTags}
        onRemove={removeTag}
        noun="tag"
        addText="tag"
        small
      />
      <ContactListsSection
        contactId={contact.id}
        contactLists={contact.lists || []}
      />
    </div>
  );
};
