/**
 * RadioDot: the mark beside each option of a radio group.
 *
 * A selected option wears the selected tint, and a tint on its own says
 * "chosen" only by hue: the tint and the grey of the other options differ by
 * about 1.1 to 1 in lightness, which WCAG 1.4.1 does not accept as the only
 * cue. The dot is the second cue: a ring on every option, filled with the
 * primary and a centre dot on the chosen one, the shape every person knows
 * from a form. It is drawn for the eye only. The option itself carries
 * `role="radio"` and `aria-checked`, or `aria-pressed`, for a screen reader.
 */
import { cn } from "../../lib/utils";

export const RadioDot = ({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "w-4 h-4 shrink-0 rounded-full flex items-center justify-center transition-colors",
      checked
        ? "bg-primary"
        : "bg-surface-container-lowest ring-2 ring-inset ring-on-surface-variant/50",
      className,
    )}
  >
    <span
      className={cn(
        "w-1.5 h-1.5 rounded-full bg-on-primary transition-transform duration-(--dur-fast)",
        checked ? "scale-100" : "scale-0",
      )}
    />
  </span>
);
