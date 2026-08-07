import React, { useState } from "react";
import { cn } from "../../../lib/utils";
import { Combobox } from "../../../components/ui/Combobox";
import { activateOnKey } from "../../../lib/a11y";

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

  const save = () => {
    setIsEditing(false);
    if (tempVal !== (value || "")) onSave(tempVal);
  };

  if (isEditing) {
    return (
      <Combobox
        // Inline editor, opened by clicking the value it replaces.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={tempVal}
        onChange={setTempVal}
        onSave={save}
        options={COMMON_INDUSTRIES}
        placeholder="Add Industry..."
      />
    );
  }
  return (
    <span
      tabIndex={0}
      role="button"
      onClick={() => {
        setIsEditing(true);
        setTempVal(value || "");
      }}
      onKeyDown={activateOnKey(() => {
        setIsEditing(true);
        setTempVal(value || "");
      })}
      className={cn(
        "cursor-pointer hover:bg-surface-container-high px-1 -mx-1 rounded transition-colors whitespace-pre-wrap max-w-full break-words outline-none text-sm font-medium",
        !value && "opacity-50 italic",
      )}
    >
      {value || "Add Industry..."}
    </span>
  );
};
