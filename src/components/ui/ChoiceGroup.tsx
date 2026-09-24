/**
 * ChoiceGroup: one choice from a few, as a radio group of tiles.
 *
 * Settings wrote this group by hand ten times, each copy with the same
 * roles, the same keys and the same tile. Eight are this now: the session
 * length, the Trash window, the backup interval and count, a dedupe scan's
 * mode, a password reset's delivery, and the role of a new account or an
 * invitation (`RolePicker`). The other two, a token's expiry and an
 * invitation's, had no hints, and a short choice with none is a
 * `Segmented`.
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
 * 2. The chosen tile wears the selected tint and a filled `RadioDot`, so
 *    "chosen" is a shape as well as a hue (WCAG 1.4.1). The others sit on
 *    the highest container tone with the hover layer.
 * 3. `pending` holds every tile while a change saves, and `locked` holds
 *    them for good, dimmed, when the environment sets the value. Both use
 *    `aria-disabled`, not `disabled`, so the focused tile keeps its focus.
 * 4. A tile with a hint puts it under the label. Pressing the chosen tile
 *    does nothing, so a click cannot save the same value twice.
 *
 * The columns are the caller's (`className`, a grid), one by default.
 *
 * @module components/ui/ChoiceGroup
 */
import React from "react";
import { radioKeys, radioTabIndex } from "../../lib/a11y";
import { SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { RadioDot } from "./RadioDot";

/** One tile: its value, its words, and an optional second line. */
export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface ChoiceGroupProps<T> {
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
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={waiting || undefined}
            tabIndex={radioTabIndex(checked, index, anyChecked)}
            onKeyDown={radioKeys}
            onClick={() => {
              if (!checked && !waiting) onChange(option.value);
            }}
            className={cn(
              "flex gap-3 text-left px-4 py-3 rounded-xl transition-colors",
              option.hint ? "items-start" : "items-center",
              waiting && "cursor-not-allowed",
              locked && "opacity-75",
              checked
                ? SELECTED_TINT
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
            </span>
          </button>
        );
      })}
    </div>
  );
}
