import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/** Native selection supports touch, keyboard arrows, and Escape inside dialogs. */
export function CustomSelect({
  value,
  onChange,
  options,
  className,
  ariaLabel = "Label",
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(className, "appearance-none cursor-pointer pr-5")}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="absolute right-1 w-2.5 h-2.5 opacity-60 pointer-events-none"
      />
    </span>
  );
}
