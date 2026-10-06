/**
 * DetailsCard: the left-column card with a contact's facts. Location, email,
 * phone, birthday, industry, preferences, interests and the next follow-up.
 *
 * Every fact is a `Field`: a sentence case label, the value, and at most one
 * way to add another. The heading stays uppercase, one step above the labels.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { useState } from "react";
import { CalendarCheck, CalendarClock } from "lucide-react";

import type {
  Contact,
  ContactUpdateData,
  ContactAddress,
} from "../../../types";
import { cn } from "../../../lib/utils";
import type { ResearchAnchor } from "../../../lib/research";
import { formatDue } from "../../../lib/datetime";
import { toLocalDay } from "../../../../shared/pulse";
import { useHiddenPendingIds } from "../../../lib/pendingDeletes";
import {
  useContactActionItems,
  useUpdateActionItem,
} from "../../../api/actionItems";
import { useMarkFollowUpDone } from "../../../hooks/useMarkFollowUpDone";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { CARD, INLINE_INPUT, SECTION_HEADING } from "../../../lib/styles";

import { LocationMiniMap } from "../../map/LocationMiniMap";
import { useMapLink } from "../../map/mapLink";
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

interface DetailsCardProps {
  contact: Contact;
  contactId: string;
  onUpdate: (field: string, val: string) => void;
  updateContact: (args: { id: string; data: ContactUpdateData }) => void;
  /**
   * The Research card asked for a detail: "city" opens Location's add form
   * and "workEmail" opens Email's, labelled work. `onDetailRequestDone`
   * spends the request once the field has opened.
   */
  detailRequest?: DetailRequest | null;
  onDetailRequestDone?: () => void;
}

/** A detail another part of the page asked to add, once per `key`. */
export interface DetailRequest {
  anchor: ResearchAnchor;
  key: number;
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
  detailRequest,
  onDetailRequestDone,
}) => {
  // The Research card's "Add a city" and "Add a work email" open these
  // fields labelled "work": research looks for the person at their job.
  const requestFor = (anchor: ResearchAnchor) =>
    detailRequest?.anchor === anchor ? detailRequest.key : undefined;
  /**
   * The addresses, from the address list or from the single legacy
   * `location` field. The mini map under the rows reads the same list, so a
   * contact with no address at all gets no map block and no caption.
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
  const mapLink = useMapLink(contactId);
  const isPlaced = contact.lat !== null && contact.lng !== null;

  // Preferences are one string on the contact, so a chip is one part of it.
  // Its id comes from its text: the same preference keeps the same chip.
  const preferences = splitPreferences(contact.preferences);
  const preferenceChips: Chip[] = preferences.map((text) => ({
    id: `pref:${text.toLowerCase()}`,
    label: text,
  }));

  const addPreferences = (texts: string[]) => {
    const next = splitPreferences([...preferences, ...texts].join(","));
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
    updateContact({ id: contactId, data: { interests: next } });

  const addInterests = (texts: string[]) =>
    saveInterests([
      ...interests,
      ...texts.map((interest) => ({
        // Not `crypto.randomUUID`: plain HTTP on a LAN has no secure context.
        id: Math.random().toString(),
        interest,
        isAiGenerated: false,
      })),
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
          Field gets no `onAdd`. Location puts the mini map and its caption
          between the rows and "+ Add": the rows, then the pin they place,
          then the way to add another. */}
      <Field label="Location">
        <MultiValueField
          items={addressItems}
          onSave={(updated) =>
            updateContact({
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
          openRequest={requestFor("city")}
          openLabel="work"
          onOpenRequestDone={onDetailRequestDone}
          isAddress
          mapLink={isPlaced ? mapLink : undefined}
          afterRows={
            <LocationMiniMap
              contact={contact}
              hasAddress={addressItems.length > 0}
            />
          }
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
            updateContact({
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
          kind="email"
          addLabel="Add email"
          inputPlaceholder="email@example.com"
          openRequest={requestFor("workEmail")}
          openLabel="work"
          onOpenRequestDone={onDetailRequestDone}
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
            updateContact({
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
          kind="phone"
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
          onAdd={addPreferences}
          onRemove={removePreference}
          noun="preference"
        />
      </Field>

      <Field label="Interests">
        <ChipInput
          chips={interestChips}
          onAdd={addInterests}
          onRemove={removeInterest}
          noun="interest"
        />
      </Field>

      {contact.nextFollowUpAt && <NextFollowUp contactId={contactId} />}
    </div>
  );
};

/**
 * The next follow-up, and the way to fix it here: a new date, or done.
 * It was read-only, so a wrong date (a weekday read as last week's) could
 * be fixed only on Pulse. A date that only says a day showed "12:00 AM".
 */
const NextFollowUp = ({ contactId }: { contactId: string }) => {
  const { data: items = [] } = useContactActionItems(contactId);
  const done = useHiddenPendingIds();
  const update = useUpdateActionItem();
  const markDone = useMarkFollowUpDone();
  const [editing, setEditing] = useState(false);
  const next = items.find((item) => !item.completedAt && !done.has(item.id));
  if (!next) return null;

  // The local day: the UTC one is the next day on an evening in America.
  const dueDay = toLocalDay(next.dueAt);

  /** A new calendar day, from the field. Unchanged or empty saves nothing. */
  const saveDate = (day: string) => {
    setEditing(false);
    if (day && day !== dueDay) {
      update.mutate({ id: next.id, data: { dueAt: day } });
    }
  };

  return (
    <Field label="Next follow-up">
      {editing ? (
        <input
          type="date"
          aria-label={`New date for ${next.title}`}
          // Opened by Change date.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          defaultValue={dueDay}
          // Saves on Enter or when focus leaves: a date field sends a change
          // for each part typed.
          onBlur={(e) => saveDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className={cn(INLINE_INPUT, "w-fit")}
        />
      ) : (
        <div className="flex items-center gap-1 min-w-0">
          <span className={cn(FIELD_VALUE, "min-w-0 break-words")}>
            {next.title} · {formatDue(next.dueAt)}
          </span>
          <ActionMenu
            label={`Change follow-up: ${next.title}`}
            iconClassName="w-4 h-4"
            items={[
              {
                id: "date",
                label: "Change date",
                icon: CalendarClock,
                onSelect: () => setEditing(true),
              },
              {
                id: "done",
                label: "Mark done",
                icon: CalendarCheck,
                onSelect: () => markDone(next.id),
              },
            ]}
          />
        </div>
      )}
    </Field>
  );
};

export const DetailsCard = React.memo(DetailsCardInner);
