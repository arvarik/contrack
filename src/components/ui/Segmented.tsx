/**
 * Segmented — the app's tab-in-a-trough toggle.
 *
 * It lived as a private component inside SettingsHome, which is where every
 * second copy of a control comes from: the next page that needs one either
 * imports from a page (wrong) or writes its own that drifts. AI usage needs
 * exactly this control for "Mine / All users", so it moved out.
 *
 * A radiogroup rather than a set of buttons, so a screen reader announces one
 * control with a selected option instead of three unrelated buttons.
 *
 * The role promises keyboard behaviour, so the behaviour is here: the arrows
 * move between options and select as they go, and only the selected option is
 * in the tab order. A radiogroup without that is a role that lies about what
 * the control does.
 */
import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { RailTooltip } from "./RailTooltip";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  /**
   * A glyph for narrow screens. With one, the option shows the glyph below
   * `sm` and the text from `sm`. The text stays in the page as the option's
   * name at every width, visually hidden where the glyph stands in for it.
   */
  icon?: LucideIcon;
}

export const Segmented = <T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the control for a screen reader. Required: it has no visible label. */
  label: string;
  className?: string;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const labelled = useMediaQuery("(min-width: 640px)");

  /**
   * Arrows move the selection, and take focus with it.
   *
   * On each radio rather than on the container: that is where focus actually
   * is, and a container carrying a key handler has to be focusable itself,
   * which a radiogroup is not.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    // Focus follows the selection, which is what makes the next arrow press
    // continue from where the last one left off.
    const buttons = container.current?.querySelectorAll("button");
    buttons?.[options.indexOf(next)]?.focus();
  };

  return (
    // On a touch screen each option is 44 px tall, the touch floor, so the
    // trough grows around them. From `sm` with a mouse the pointer look
    // returns: a 36 px trough.
    <div
      ref={container}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex bg-surface-container rounded-lg p-1 h-auto sm:pointer-fine:h-9 w-full sm:w-auto",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            // Only the selected option is a tab stop, so Tab moves past the
            // whole control rather than through every option in it.
            tabIndex={value === option.value ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 sm:flex-none px-3 sm:px-4 min-h-[44px] sm:pointer-fine:min-h-0 sm:pointer-fine:h-full rounded-md text-xs font-bold",
              "flex items-center justify-center whitespace-nowrap transition-colors",
              // A glyph alone is narrower than a thumb, so it gets the width
              // floor as well as the height.
              Icon && "min-w-[44px] sm:pointer-fine:min-w-0",
              // An option not chosen is a flat control in the trough: the
              // hover and press layer, like every flat control.
              value === option.value
                ? "bg-surface shadow-sm text-primary"
                : "state-layer text-on-surface-variant hover:text-on-surface",
            )}
          >
            {Icon ? (
              <>
                <Icon aria-hidden="true" className="w-4 h-4 sm:hidden" />
                <span className="sr-only sm:not-sr-only">{option.label}</span>
              </>
            ) : (
              option.label
            )}
          </button>
        );
        // Below `sm` a glyph stands alone, so a long press names it. From
        // `sm` the label shows, and needs no tooltip.
        return Icon ? (
          <RailTooltip
            key={option.value}
            label={option.label}
            side="bottom"
            disabled={labelled}
            className="flex-1 sm:flex-none"
          >
            {button}
          </RailTooltip>
        ) : (
          button
        );
      })}
    </div>
  );
};
