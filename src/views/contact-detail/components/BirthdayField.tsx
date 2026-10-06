/**
 * BirthdayField: a birthday, with or without a year, edited as text.
 *
 * It was a date input. A date input needs a year, so "May 14" opened as
 * 2001 and a save kept that year, and Chrome sends a change for each typed
 * part, so a typed date saved after its first digit. A text field takes
 * "May 14" or "May 14, 1990" (`parseBirthday`), and saves on Enter or when
 * focus leaves. Escape puts it back. An empty field removes the birthday.
 */
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";
import { TONE_WASH } from "../../../lib/styles";
import { EditHint } from "./EditableField";
import { AddButton } from "./Field";
import {
  birthdayText,
  formatBirthdayDisplay,
  getUpcomingBirthdayDays,
} from "../../../lib/birthday";
import { birthdayValue, parseBirthday } from "../../../../shared/birthday";

export const BirthdayField = ({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (val: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const invalidId = useId();
  const button = useRef<HTMLButtonElement>(null);
  /** A key closed the field: focus goes back to the value, and the blur that follows saves nothing. */
  const closedByKey = useRef(false);

  useEffect(() => {
    if (isEditing || !closedByKey.current) return;
    closedByKey.current = false;
    button.current?.focus();
  }, [isEditing]);

  /** Save the text when it is a date or empty. False when it is neither. */
  const commit = (text: string): boolean => {
    const trimmed = text.trim();
    const parsed = parseBirthday(trimmed);
    if (trimmed && !parsed) return false;
    const next = parsed ? birthdayValue(parsed) : "";
    if (next !== (value ?? "")) onSave(next);
    return true;
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          aria-label="Birthday"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? invalidId : undefined}
          // Inline editor, opened by pressing the value it replaces.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          defaultValue={birthdayText(value)}
          placeholder="May 14, or May 14, 1990"
          onChange={() => setInvalid(false)}
          onBlur={(e) => {
            if (closedByKey.current) return;
            const text = e.target.value.trim();
            if (!commit(text))
              toast.error(`Could not read "${text}" as a date`);
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Enter" && !commit(e.currentTarget.value)) {
              setInvalid(true);
              return;
            }
            closedByKey.current = true;
            setIsEditing(false);
          }}
          className="min-h-[44px] sm:pointer-fine:min-h-0 text-base sm:text-sm font-medium bg-surface-container-high rounded-lg px-2 py-1 border-none w-full"
        />
        {invalid && (
          <p id={invalidId} className="text-xs font-semibold text-error">
            Use a date like May 14, or May 14, 1990
          </p>
        )}
      </div>
    );
  }

  const display = formatBirthdayDisplay(value);
  // The card's one "+ Add" look, as under every other empty field.
  if (!display) {
    return (
      <AddButton
        ref={button}
        label="Add birthday"
        onClick={() => setIsEditing(true)}
      />
    );
  }
  const upcomingDays = getUpcomingBirthdayDays(value);

  return (
    // 44 px tall on a phone, so the row gives the value's tap box room.
    <div className="flex flex-wrap items-center gap-2 min-h-[44px] sm:pointer-fine:min-h-0">
      {/* A real button: Enter and Space open the field with no key
          handler, and `group/edit` shows the pencil on keyboard focus. */}
      <button
        ref={button}
        type="button"
        onClick={() => setIsEditing(true)}
        className="group/edit hit-area state-layer inline-flex w-fit max-w-full items-center gap-1.5 rounded text-left text-sm font-medium cursor-text transition-colors text-on-surface"
      >
        <span className="min-w-0 break-words">{display}</span>
        <EditHint />
      </button>
      {upcomingDays !== null && (
        <span
          className={cn(
            "text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0",
            TONE_WASH.warning,
          )}
        >
          {upcomingDays === 0 ? "🎂 Today" : `🎂 in ${upcomingDays}d`}
        </span>
      )}
    </div>
  );
};
