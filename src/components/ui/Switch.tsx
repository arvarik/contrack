/**
 * The on/off control for every on/off setting.
 *
 * A 44 by 24 px track. Off: the highest container tone in a hairline, with a
 * 16 px knob in the variant ink, visible in either palette. On: the accent,
 * with a 20 px on-accent knob holding a check, so the state shows three ways.
 *
 * The button is the track, and `hit-area` gives it the 44 px tap box, so it
 * lines up with the other controls on a row's right edge.
 */
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The control's accessible name. */
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
}: SwitchProps) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "hit-area group shrink-0 inline-flex items-center w-11 h-6 rounded-full cursor-pointer",
      "transition-colors",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      checked
        ? "bg-primary"
        : "bg-surface-container-highest ring-1 ring-inset ring-outline-variant",
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-full",
        // The app's curve and base duration (index.css, "Motion").
        "transition-[translate,width,height,background-color]",
        "group-active:scale-110 group-disabled:scale-100",
        checked
          ? "w-5 h-5 translate-x-[22px] bg-on-primary text-primary"
          : "w-4 h-4 translate-x-1 bg-on-surface-variant",
      )}
    >
      <Check
        strokeWidth={3}
        className={cn(
          "w-3 h-3 transition-opacity",
          checked ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  </button>
);
