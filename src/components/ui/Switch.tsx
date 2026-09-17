import React from "react";
import { cn } from "../../lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export const Switch = ({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}: SwitchProps) => {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "shrink-0 inline-flex items-center justify-center",
        "min-w-[44px] min-h-[44px] rounded-full",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative block w-14 h-8 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-surface-container-high",
        )}
      >
        <span
          className={cn(
            "absolute top-1 w-6 h-6 rounded-full bg-surface-container-lowest shadow-sm",
            "transition-transform",
            checked ? "translate-x-7" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
};
