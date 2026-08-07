import React, { useState } from "react";
import { cn } from "../../lib/utils";
import { DROPDOWN_MENU, DROPDOWN_ITEM, EDITABLE_INPUT } from "../../lib/styles";
import { activateOnKey } from "../../lib/a11y";

export const Combobox = ({
  value,
  onChange,
  onSave,
  options,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (val: string) => void;
  onSave: () => void;
  options: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(true);

  // Filter out exact matches if they are the only ones, but generally show what matches
  const filteredOptions = options.filter((o) =>
    o.toLowerCase().includes(value.toLowerCase()),
  );

  return (
    <div className="relative flex-1 group">
      <input
        aria-label={placeholder ?? "Value"}
        // Opened by the caller in response to a click-to-edit.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        className={cn(EDITABLE_INPUT, "text-sm font-medium w-full")}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          setIsOpen(false);
          onSave();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onSave();
        }}
        placeholder={placeholder}
      />

      {isOpen && filteredOptions.length > 0 && (
        <ul className={cn(DROPDOWN_MENU)}>
          {filteredOptions.map((opt) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              tabIndex={0}
              // Mouse commits on mousedown to beat the input's blur; the
              // keyboard path has no blur to race, so it commits directly.
              onKeyDown={activateOnKey(() => {
                onChange(opt);
                setIsOpen(false);
                setTimeout(() => onSave(), 10);
              })}
              className={DROPDOWN_ITEM}
              onMouseDown={(e) => {
                // Prevent input blur so we can process the click securely
                e.preventDefault();
                onChange(opt);
                setIsOpen(false);
                setTimeout(() => onSave(), 10);
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
