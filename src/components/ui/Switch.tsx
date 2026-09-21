/**
 * Switch: the on/off control.
 *
 * One switch for every on/off setting: "Local time and weather", "Anyone can
 * create an account", "Send it by email". It used to be a 56 by 32 px pill
 * whose knob was the card colour, so in the dark palette the off state was
 * a grey blob with a knob nobody could see, and it sat in a 44 px square of
 * its own that pushed it off the row's right edge.
 *
 * The track is 44 by 24 px. Off, it is the highest container tone inside a
 * hairline, with a 16 px knob in the variant text colour, so it reads as a
 * control on any surface in either palette. On, the track is the accent and
 * the knob grows to 20 px in the on-accent colour with a check inside it,
 * so the state is told three ways: the knob's side, its colour and the
 * glyph. A press swells the knob a little under the thumb, and the move
 * takes 200 ms on the standard curve.
 *
 * The button is the track. `hit-area` gives it the 44 px tap box
 * `.agent/STYLE.md` requires without a box of its own, so the track lines
 * up with the other controls on a row's right edge.
 *
 * @module components/ui/Switch
 */
import React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The control's accessible name. */
  label: string;
  disabled?: boolean;
  id?: string;
  /** Extra classes for the track. */
  className?: string;
}

/** The standard curve: fast out, settles gently. */
const EASE = "duration-200 ease-[cubic-bezier(0.2,0,0,1)]";

export const Switch = ({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  className,
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
      EASE,
      "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      checked
        ? "bg-primary"
        : "bg-surface-container-highest ring-1 ring-inset ring-outline-variant",
      className,
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-full",
        "transition-[transform,width,height,background-color]",
        EASE,
        "group-active:scale-110 group-disabled:scale-100",
        checked
          ? "w-5 h-5 translate-x-[22px] bg-on-primary text-primary"
          : "w-4 h-4 translate-x-1 bg-on-surface-variant",
      )}
    >
      <Check
        strokeWidth={3}
        className={cn(
          "w-3 h-3 transition-opacity duration-150",
          checked ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  </button>
);
