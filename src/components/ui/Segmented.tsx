/**
 * Segmented — the app's pill-in-a-trough toggle.
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
}) => {
  const container = useRef<HTMLDivElement>(null);

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
    <div
      ref={container}
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
          // Only the selected option is a tab stop, so Tab moves past the
          // whole control rather than through every option in it.
          tabIndex={value === option.value ? 0 : -1}
          onKeyDown={onKeyDown}
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
};
