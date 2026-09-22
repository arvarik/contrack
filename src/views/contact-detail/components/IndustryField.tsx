import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { Combobox } from "../../../components/ui/Combobox";
import { EditHint } from "./EditableField";

const COMMON_INDUSTRIES = [
  "Finance",
  "FinTech",
  "Healthcare",
  "HealthTech",
  "Biotech",
  "Technology",
  "Software",
  "SaaS",
  "Cybersecurity",
  "AI / ML",
  "E-commerce",
  "Retail",
  "Venture Capital",
  "Private Equity",
  "Real Estate",
  "Media",
  "Entertainment",
  "Marketing",
  "Education",
  "EdTech",
  "Law",
  "Government",
  "Non-Profit",
].sort();

export const IndustryField = ({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempVal, setTempVal] = useState(value || "");
  const button = useRef<HTMLButtonElement>(null);
  /**
   * True when Enter or Escape closed the editor. The input leaves the page,
   * so focus goes back to the value. A blur closes it too, and then focus
   * is already somewhere else and stays there.
   */
  const refocus = useRef(false);

  useEffect(() => {
    if (isEditing || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [isEditing]);

  const save = () => {
    setIsEditing(false);
    if (tempVal !== (value || "")) onSave(tempVal);
  };

  if (isEditing) {
    return (
      <div
        // Capture only notes the key. The combobox runs its own handler.
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" || e.key === "Escape") refocus.current = true;
        }}
      >
        <Combobox
          // Inline editor, opened by clicking the value it replaces.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={tempVal}
          onChange={setTempVal}
          onSave={save}
          options={COMMON_INDUSTRIES}
          placeholder="Add industry"
        />
      </div>
    );
  }
  return (
    // 44 px tall on a phone, so the row gives the value's tap box room.
    <div className="flex items-center min-h-[44px] sm:min-h-0">
      {/* A real button: Enter and Space open the editor with no key handler,
          and `group/edit` shows the pencil on keyboard focus. hit-area: a
          short value such as "Law" is narrower than a thumb. */}
      <button
        ref={button}
        type="button"
        onClick={() => {
          setIsEditing(true);
          setTempVal(value || "");
        }}
        className={cn(
          "group/edit hit-area state-layer inline-flex w-fit max-w-full items-center gap-1.5 rounded text-left text-sm font-medium cursor-pointer transition-colors",
          // Italic and the muted token, NOT opacity. Half-opacity text is half
          // the contrast: this placeholder measured 2.86:1 on a white card, and
          // a prompt somebody is meant to read and click is content rather than
          // decoration. The browser audit found it on the contact detail route
          // the first time that route was reachable.
          value ? "text-on-surface" : "italic text-on-surface-variant",
        )}
      >
        <span className="min-w-0 whitespace-pre-wrap break-words">
          {value || "Add industry"}
        </span>
        <EditHint />
      </button>
    </div>
  );
};
