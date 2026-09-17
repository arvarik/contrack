import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { EditHint } from "./EditableField";

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

  // Normalize stored value to YYYY-MM-DD for the input
  const toInputValue = (v: string | null): string => {
    if (!v) return "";
    // If already YYYY-MM-DD, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    // Try parsing other formats
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
    return "";
  };

  const formatDisplay = (v: string | null): string | null => {
    if (!v) return null;
    try {
      const inputVal = toInputValue(v);
      if (!inputVal) return v;
      // Parse as local date (avoid UTC shift)
      const [year, month, day] = inputVal.split("-").map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return v;
    }
  };

  // Upcoming birthday badge (within 30 days)
  const upcomingDays = (() => {
    const inputVal = toInputValue(value);
    if (!inputVal) return null;
    const [, month, day] = inputVal.split("-").map(Number);
    const today = new Date();
    const thisYear = today.getFullYear();
    let bday = new Date(thisYear, month - 1, day);
    if (bday < today) bday = new Date(thisYear + 1, month - 1, day);
    const diff = Math.round(
      (bday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return diff <= 30 ? diff : null;
  })();

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
        defaultValue={toInputValue(value)}
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
        className="min-h-[44px] sm:min-h-0 text-sm font-medium bg-surface-container-high rounded-lg px-2 py-1 border-none focus:ring-2 focus:ring-primary/30 focus:outline-none w-full"
      />
    );
  }

  const display = formatDisplay(value);

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
          "group/edit hit-area inline-flex w-fit max-w-full items-center gap-1.5 rounded text-left text-sm font-medium cursor-text transition-colors hover:bg-surface-container-high",
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
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-warning shrink-0">
          {upcomingDays === 0 ? "🎂 Today!" : `🎂 in ${upcomingDays}d`}
        </span>
      )}
    </div>
  );
};
