/**
 * A birthday, with or without a year, edited as text (`parseBirthday`). Not
 * a date input: that needs a year, and Chrome fires a change per typed part.
 * Enter or blur saves, Escape cancels, and an empty field removes it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";
import { INLINE_INPUT, TONE_WASH } from "../../../lib/styles";
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
  /** A key closed the field: refocus the value, and skip the blur's save. */
  const closedByKey = useRef(false);

  useEffect(() => {
    if (isEditing || !closedByKey.current) return;
    closedByKey.current = false;
    button.current?.focus();
  }, [isEditing]);

  /** Saves a date or an empty text. False for anything else. */
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
          className={cn(INLINE_INPUT, "w-full")}
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
    // 44 px tall on a phone, for the value's tap target.
    <div className="flex flex-wrap items-center gap-2 min-h-[44px] sm:pointer-fine:min-h-0">
      {/* `group/edit` shows the pencil on keyboard focus too. */}
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
