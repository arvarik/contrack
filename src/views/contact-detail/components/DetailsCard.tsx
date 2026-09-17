/**
 * DetailsCard: the left-column card with a contact's facts. Location, email,
 * phone, birthday, industry, preferences, interests and the next follow-up.
 *
 * Every fact is a `Field`: a sentence case label, the value, and at most one
 * way to add another. The heading stays uppercase, one step above the labels.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React from "react";

import type {
  Contact,
  ContactUpdateData,
  ContactAddress,
} from "../../../types";
import { cn } from "../../../lib/utils";
import { CARD, SECTION_HEADING } from "../../../lib/styles";

import { LocationMiniMap } from "../../map/LocationMiniMap";
import { IndustryField } from "./IndustryField";
import { BirthdayField } from "./BirthdayField";
import { ChipInput, type Chip } from "./ChipInput";
import { Field, FIELD_VALUE, showUndoToast } from "./Field";
import {
  MultiValueField,
  EMAIL_LABELS,
  PHONE_LABELS,
  ADDR_LABELS,
} from "./MultiValueField";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface DetailsCardProps {
  contact: Contact;
  contactId: string;
  onUpdate: (field: string, val: string) => void;
  updateContact: {
    mutate: (args: { id: string; data: ContactUpdateData }) => void;
  };
}

/**
 * The parts of the comma-joined preferences string: trimmed, with no blanks
 * and no repeats. A repeat that differs only in case is a repeat, because
 * each part is also a chip id, and two chips must not share one.
 */
const splitPreferences = (text: string | null | undefined): string[] => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of (text ?? "").split(",")) {
    const part = raw.trim();
    const key = part.toLowerCase();
    if (!part || seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts;
};

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

const DetailsCardInner: React.FC<DetailsCardProps> = ({
  contact,
  contactId,
  onUpdate,
  updateContact,
}) => {
  /**
   * The addresses, from the address list or from the single legacy
   * `location` field. The mini map below reads the same list, so a contact
   * with no address at all gets no map block and no caption.
   */
  const addressItems =
    contact.addresses && contact.addresses.length > 0
      ? contact.addresses.map((a: ContactAddress) => ({
          id: a.id,
          value: a.address,
          label: a.label || "home",
        }))
      : contact.location
        ? [{ id: "legacy-init", value: contact.location, label: "home" }]
        : [];
  const isPlaced = contact.lat !== null && contact.lng !== null;

  // Preferences are one string on the contact, so a chip is one part of it.
  // Its id comes from its text: the same preference keeps the same chip.
  const preferences = splitPreferences(contact.preferences);
  const preferenceChips: Chip[] = preferences.map((text) => ({
    id: `pref:${text.toLowerCase()}`,
    label: text,
  }));

  const addPreference = (text: string) => {
    // "Tea, Jazz" is two preferences, and a comma inside one would split it
    // on the next read anyway.
    const next = splitPreferences([...preferences, text].join(","));
    if (next.length === preferences.length) return;
    onUpdate("preferences", next.join(", "));
  };

  const removePreference = (chip: Chip) => {
    const before = contact.preferences ?? "";
    const next = preferences.filter(
      (text) => text.toLowerCase() !== chip.label.toLowerCase(),
    );
    onUpdate("preferences", next.join(", "));
    showUndoToast(`Removed "${chip.label}"`, () =>
      onUpdate("preferences", before),
    );
  };

  const interests = contact.interests ?? [];
  const interestChips: Chip[] = interests.map((interest) => ({
    id: interest.id,
    label: interest.interest,
    ai: !!interest.isAiGenerated,
  }));

  const saveInterests = (next: ContactUpdateData["interests"]) =>
    updateContact.mutate({ id: contactId, data: { interests: next } });

  const addInterest = (text: string) =>
    saveInterests([
      ...interests,
      { id: Math.random().toString(), interest: text, isAiGenerated: false },
    ]);

  const removeInterest = (chip: Chip) => {
    const before = interests;
    saveInterests(interests.filter((interest) => interest.id !== chip.id));
    showUndoToast(`Removed "${chip.label}"`, () => saveInterests(before));
  };

  return (
    <div className={cn(CARD, "space-y-5")}>
      {/* h2: the first section under the contact's name, which is the h1. */}
      <h2 className={cn(SECTION_HEADING, "pb-2 mb-4")}>Details</h2>

      {/* The list fields draw their own "+ Add" under their rows, so the
          Field gets no `onAdd`. */}
      <Field label="Location">
        <MultiValueField
          items={addressItems}
          onSave={(updated) =>
            updateContact.mutate({
              id: contactId,
              data: {
                addresses: updated.map((a, i) => ({
                  address: a.value,
                  label: a.label || "home",
                  isPrimary: i === 0,
                })),
              },
            })
          }
          labelOptions={ADDR_LABELS}
          noun="address"
          addLabel="Add location"
          inputPlaceholder="San Francisco, CA"
          isAddress
          mapHref={isPlaced ? `/map/contact/${contactId}` : undefined}
        />
        <LocationMiniMap
          contact={contact}
          hasAddress={addressItems.length > 0}
        />
      </Field>

      <Field label="Email">
        <MultiValueField
          items={(contact.emails ?? []).map((e) => ({
            id: e.id,
            value: e.email,
            label: e.label || "personal",
          }))}
          onSave={(updated) =>
            updateContact.mutate({
              id: contactId,
              data: {
                emails: updated.map((e, i) => ({
                  email: e.value,
                  label: e.label,
                  isPrimary: i === 0,
                })),
              },
            })
          }
          labelOptions={EMAIL_LABELS}
          noun="email"
          addLabel="Add email"
          inputPlaceholder="email@example.com"
        />
      </Field>

      <Field label="Phone">
        <MultiValueField
          items={(contact.phones ?? []).map((p) => ({
            id: p.id,
            value: p.phone,
            label: p.label || "mobile",
          }))}
          onSave={(updated) =>
            updateContact.mutate({
              id: contactId,
              data: {
                phones: updated.map((p, i) => ({
                  phone: p.value,
                  label: p.label,
                  isPrimary: i === 0,
                })),
              },
            })
          }
          labelOptions={PHONE_LABELS}
          noun="phone"
          addLabel="Add phone"
          inputPlaceholder="+1 (555) 000-0000"
        />
      </Field>

      <Field label="Birthday">
        <BirthdayField
          value={contact.birthday}
          onSave={(val) => onUpdate("birthday", val)}
        />
      </Field>

      <Field label="Industry">
        <IndustryField
          value={contact.industry}
          onSave={(val) => onUpdate("industry", val)}
        />
      </Field>

      <Field label="Preferences">
        <ChipInput
          chips={preferenceChips}
          onAdd={addPreference}
          onRemove={removePreference}
          noun="preference"
        />
      </Field>

      <Field label="Interests">
        <ChipInput
          chips={interestChips}
          onAdd={addInterest}
          onRemove={removeInterest}
          noun="interest"
        />
      </Field>

      {contact.nextFollowUpAt && (
        <Field label="Next follow-up">
          <span className={FIELD_VALUE}>
            {new Date(contact.nextFollowUpAt).toLocaleString()}
          </span>
        </Field>
      )}
    </div>
  );
};

export const DetailsCard = React.memo(DetailsCardInner);
