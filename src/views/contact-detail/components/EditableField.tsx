/**
 * EditableField — Inline editable text with save feedback.
 *
 * On blur (or Enter), if the value changed, fires onSave() and plays a brief
 * ✓ confirmation animation so users know the change was persisted.
 * Escape reverts to the original value without saving.
 */
import React, { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { cn } from "../../../lib/utils";
import { EDITABLE_INPUT } from "../../../lib/styles";

export const EditableField = ({
  value,
  onSave,
  placeholder,
  className = "",
}: {
  value: string | null;
  onSave: (val: string) => void;
  placeholder: string;
  className?: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [currentVal, setCurrentVal] = useState(value || "");
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    setCurrentVal(value || "");
  }, [value]);

  const handleBlur = () => {
    setIsEditing(false);
    if (currentVal.trim() !== (value || "")) {
      onSave(currentVal.trim());
      // Show brief ✓ confirmation
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 1500);
      return () => clearTimeout(t);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setCurrentVal(value || "");
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        value={currentVal}
        onChange={(e) => setCurrentVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(EDITABLE_INPUT, className)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={() => setIsEditing(true)}
      className={cn(
        "relative cursor-text group inline-flex items-center gap-1.5",
        !value && "text-on-surface-variant opacity-50 italic",
        className,
      )}
    >
      {/* Absolute hover background layer completely decoupled from flex flow */}
      <span className="absolute -inset-x-2 -top-1 -bottom-1.5 rounded bg-transparent group-hover:bg-surface-container-high transition-colors -z-10 pointer-events-none" />
      <span className="relative pointer-events-none">
        {value || placeholder}
      </span>
      {/* Save confirmation ✓ — fades in/out */}
      {showSaved && (
        <span
          className="inline-flex items-center shrink-0 text-emerald-500 animate-fade-in pointer-events-none"
          aria-label="Saved"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </span>
      )}
    </span>
  );
};
