import { useState } from "react";
import { cn } from "../../lib/utils";
import {
  DROPDOWN_MENU,
  DROPDOWN_ITEM,
  EDITABLE_INPUT,
  MENU_ITEM_SELECTED,
} from "../../lib/styles";
import { NO_AUTOCORRECT } from "./SearchField";

export const Combobox = ({
  value,
  onChange,
  onSave,
  onCancel,
  options,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (val: string) => void;
  onSave: (val?: string) => void;
  onCancel?: () => void;
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
        {...NO_AUTOCORRECT}
        className={cn(
          EDITABLE_INPUT,
          "min-h-[44px] sm:pointer-fine:min-h-0 text-base sm:text-sm font-medium w-full",
        )}
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
          if (e.key === "Escape") {
            setIsOpen(false);
            if (onCancel) onCancel();
            else onSave();
          }
        }}
        placeholder={placeholder}
      />

      {isOpen && filteredOptions.length > 0 && (
        <ul className={cn(DROPDOWN_MENU)}>
          {filteredOptions.map((opt) => (
            // Keyboard users type in the input above; keeping options out of
            // Tab order stops touch scrolling from focusing an item and
            // blurring the input before the tap completes.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              className={cn(DROPDOWN_ITEM, opt === value && MENU_ITEM_SELECTED)}
              onMouseDown={(e) => {
                // Keep focus on the input while the option is pressed.
                e.preventDefault();
              }}
              onClick={() => {
                onChange(opt);
                setIsOpen(false);
                onSave(opt);
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
