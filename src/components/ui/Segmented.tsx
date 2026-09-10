/**
 * Segmented — the app's pill-in-a-trough toggle.
 *
 * It lived as a private component inside SettingsHome, which is where every
 * second copy of a control comes from: the next page that needs one either
 * imports from a page (wrong) or writes its own that drifts. AI usage needs
 * exactly this control for "Mine / All users", so it moved out.
 *
 * A radiogroup rather than a set of buttons, so a screen reader announces one
 * control with a selected option instead of three unrelated buttons, and the
 * arrow keys work.
 */
import { cn } from "../../lib/utils";

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Names the control for a screen reader. Required: it has no visible label. */
  label: string;
  className?: string;
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className={cn(
      "flex bg-surface-container rounded-full p-1 shadow-inner h-9 w-full sm:w-auto",
      className,
    )}
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "flex-1 sm:flex-none px-3 sm:px-4 h-full rounded-full text-xs font-bold",
          "flex items-center justify-center whitespace-nowrap transition-colors",
          value === option.value
            ? "bg-surface shadow-sm text-primary"
            : "text-on-surface-variant hover:text-on-surface",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);
