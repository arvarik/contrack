/**
 * The mark beside each option of a radio group: the cue besides the tint
 * (about 1.1 to 1 from the others, too little alone for WCAG 1.4.1). A ring
 * on every option, filled with a center dot on the chosen one. For the eye
 * only: the option carries `role="radio"` and `aria-checked`, or
 * `aria-pressed`.
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
