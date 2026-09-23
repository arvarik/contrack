import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { TONE_WASH } from "../../../lib/styles";
import { EditHint } from "./EditableField";
import {
  toBirthdayInputValue,
  formatBirthdayDisplay,
  getUpcomingBirthdayDays,
} from "../../../lib/birthday";

export const BirthdayField = ({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (val: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /**
   * True when a key closed the date input. The input leaves the page, so
   * focus goes back to the value, as it does for every other value in the
   * card.
   */
  const refocus = useRef(false);

  useEffect(() => {
    if (isEditing || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [isEditing]);

  const upcomingDays = getUpcomingBirthdayDays(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // YYYY-MM-DD
    if (val) {
      onSave(val);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        aria-label="Birthday"
        type="date"
        // Inline editor, opened by clicking the value it replaces.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        defaultValue={toBirthdayInputValue(value)}
        onChange={handleChange}
        onBlur={() => setIsEditing(false)}
        onKeyDown={(e) => {
          // A date saves as soon as it is whole, so Enter and Escape both
          // only close the input.
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            refocus.current = true;
            setIsEditing(false);
          }
        }}
        className="min-h-[44px] sm:min-h-0 text-sm font-medium bg-surface-container-high rounded-lg px-2 py-1 border-none w-full"
      />
    );
  }

  const display = formatBirthdayDisplay(value);

  return (
    // 44 px tall on a phone, so the row gives the value's tap box room.
    <div className="flex flex-wrap items-center gap-2 min-h-[44px] sm:min-h-0">
      {/* A real button: Enter and Space open the date input with no key
          handler, and `group/edit` shows the pencil on keyboard focus. */}
      <button
        ref={button}
        type="button"
        onClick={() => setIsEditing(true)}
        className={cn(
          "group/edit hit-area state-layer inline-flex w-fit max-w-full items-center gap-1.5 rounded text-left text-sm font-medium cursor-text transition-colors",
          display
            ? "text-on-surface"
            : // Italic rather than half-opacity: the same prompt measured
              // 2.19:1 on a white card, and it is text somebody has to read.
              "text-on-surface-variant italic",
        )}
      >
        <span className="min-w-0 break-words">{display || "Add birthday"}</span>
        <EditHint />
      </button>
      {upcomingDays !== null && (
        <span
          className={cn(
            "text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0",
            TONE_WASH.warning,
          )}
        >
          {upcomingDays === 0 ? "🎂 Today!" : `🎂 in ${upcomingDays}d`}
        </span>
      )}
    </div>
  );
};
