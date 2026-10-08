/**
 * An icon-only button with at least a 44 px square tap area, whatever the
 * icon's size. `tone` and `size` change only the color and the padding.
 *
 *   <IconButton aria-label="Close" onClick={…}><X className="w-5 h-5" /></IconButton>
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

type Tone = "ghost" | "subtle" | "danger";
type Size = "sm" | "md" | "lg";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility — icon-only buttons MUST have an aria-label. */
  "aria-label": string;
  /** The icon (a Lucide icon, an emoji, anything renderable). */
  children: ReactNode;
  /** Visual style. `ghost` = transparent until hovered (default). */
  tone?: Tone;
  /** Visible chrome size. Touch area is always ≥ 44×44 regardless. */
  size?: Size;
}

/** Every tone hovers with the one state layer (`.state-layer` in index.css). */
const toneClasses: Record<Tone, string> = {
  ghost: "text-on-surface",
  subtle: "text-on-surface-variant hover:text-on-surface",
  danger: "text-error",
};

// The visible padding. `min-w/h-[44px]` keeps even `sm` at the tap floor.
const sizeClasses: Record<Size, string> = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, tone = "ghost", size = "md", className, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        {...rest}
        className={cn(
          // A 44px minimum tap area on every device. The state layer draws
          // the press.
          "state-layer inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl transition-colors",
          "disabled:opacity-40 disabled:pointer-events-none",
          sizeClasses[size],
          toneClasses[tone],
          className,
        )}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";
