import { useEffect, useRef, useState } from "react";
import { AddButton } from "./Field";
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
  // Set when Enter or Escape closes the editor, so focus returns to the
  // value. After a blur, focus is already elsewhere and stays there.
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
  // The card's one "+ Add" look, as under every other empty field.
  if (!value) {
    return (
      <AddButton
        ref={button}
        label="Add industry"
        onClick={() => {
          setIsEditing(true);
          setTempVal("");
        }}
      />
    );
  }
  return (
    // 44 px tall on a phone, so the row gives the value's tap box room.
    <div className="flex items-center min-h-[44px] sm:pointer-fine:min-h-0">
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
        className="group/edit hit-area state-layer inline-flex w-fit max-w-full items-center gap-1.5 rounded text-left text-sm font-medium cursor-pointer transition-colors text-on-surface"
      >
        <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        <EditHint />
      </button>
    </div>
  );
};
