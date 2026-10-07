/**
 * One choice from a few, as a radio group of tiles with hints. A short
 * choice with no hints is a `Segmented`.
 *
 * ```
 * ┌──────────────────────┐ ┌──────────────────────┐
 * │ ◉ 30 days            │ │ ○ 1 year             │
 * │   Default            │ │   Private machine    │
 * └──────────────────────┘ └──────────────────────┘
 * ```
 *
 * 1. The group is `role="radiogroup"`, named by `label`. Each tile is a
 *    `role="radio"` with `aria-checked`, one Tab stop for the group (the
 *    checked tile, or the first when none is), and the arrow keys move the
 *    choice (`radioKeys`).
 * 2. The chosen tile wears the selected tint and a filled `RadioDot`, a
 *    shape as well as a hue (WCAG 1.4.1).
 * 3. `pending` holds every tile while a change saves, and `locked` holds
 *    them dimmed when the environment sets the value. Both use
 *    `aria-disabled`, not `disabled`, so the focused tile keeps its focus.
 * 4. A hint goes under the label, and a `detail` (a time and a cost) on its
 *    own line under that. Pressing the chosen tile does nothing.
 * 5. A `disabled` tile cannot run now, such as an engine with no setup. It
 *    stays, dimmed, its hint saying why. The arrow keys skip it.
 *
 * The columns are the caller's (`className`, a grid), one by default.
 */
import { radioKeys, radioTabIndex } from "../../lib/a11y";
import { SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { RadioDot } from "./RadioDot";

/** One tile: its value, its words, and up to two lines under them. */
export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
  /** A third line, in figures: "About 30 s and $0.13 a contact". */
  detail?: string;
  /** It cannot be chosen now. Its hint says why. */
  disabled?: boolean;
}

interface ChoiceGroupProps<T> {
  /** The group's accessible name, such as "Session length". */
  label: string;
  /** The chosen value. A value no tile has checks none. */
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  /** A change is saving: every tile waits. */
  pending?: boolean;
  /** The environment sets the value: the tiles show it, dimmed, and wait. */
  locked?: boolean;
  /** The grid's columns and any other classes for the group. */
  className?: string;
}

export function ChoiceGroup<T>({
  label,
  value,
  options,
  onChange,
  pending = false,
  locked = false,
  className,
}: ChoiceGroupProps<T>) {
  const anyChecked = options.some((option) => option.value === value);
  const waiting = pending || locked;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-2", className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const unavailable = option.disabled === true;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={waiting || unavailable || undefined}
            tabIndex={radioTabIndex(checked, index, anyChecked)}
            onKeyDown={radioKeys}
            onClick={() => {
              if (!checked && !waiting && !unavailable) onChange(option.value);
            }}
            className={cn(
              "flex gap-3 text-left px-4 py-3 rounded-xl transition-colors",
              option.hint ? "items-start" : "items-center",
              (waiting || unavailable) && "cursor-not-allowed",
              locked && "opacity-75",
              unavailable && !checked && "opacity-60",
              checked
                ? SELECTED_TINT
                : unavailable
                  ? "bg-surface-container-highest"
                  : "state-layer bg-surface-container-highest",
            )}
          >
            <RadioDot
              checked={checked}
              className={option.hint ? "mt-0.5" : undefined}
            />
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-sm font-bold",
                  !checked && "text-on-surface",
                )}
              >
                {option.label}
              </span>
              {option.hint && (
                <span className="block text-xs text-on-surface-variant mt-0.5">
                  {option.hint}
                </span>
              )}
              {option.detail && (
                <span className="block text-xs font-semibold text-on-surface tabular-nums mt-1">
                  {option.detail}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
