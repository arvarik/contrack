/**
 * IconButton — touch-safe icon-only button.
 *
 * Why this primitive exists:
 *   The codebase had repeated patterns like `<button class="p-1.5">…</button>`
 *   that produced 28–32 px hit targets — below both Apple HIG (44 px) and
 *   Material (48 px) accessibility minimums. On phones these are missable.
 *   This component guarantees a 44 px square minimum regardless of the icon
 *   size, while keeping the *visible* icon size tunable independently.
 *
 * The visible padding only grows the centered icon's halo; the real touch
 * area is the full square. We do NOT inflate the visual chrome — `tone` and
 * `size` only affect color and icon dimensions, never the hit area.
 *
 *   <IconButton aria-label="Close" onClick={…}><X className="w-5 h-5" /></IconButton>
 */
import { forwardRef, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Tone = "ghost" | "subtle" | "primary" | "danger";
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

const toneClasses: Record<Tone, string> = {
  ghost:   "text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest",
  subtle:  "text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest",
  primary: "text-primary hover:bg-primary/10 active:bg-primary/20",
  danger:  "text-error hover:bg-error/10 active:bg-error/20",
};

// Visible "padding-bubble" sizes. Each is paired with a guaranteed minimum
// hit-area via `min-w/h-[44px]` so even the `sm` variant remains touch-safe.
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
          // Touch-safe baseline: 44px minimum hit area on every device.
          // The CSS variable -webkit-tap-highlight-color is killed because we
          // render our own active state.
          "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          "disabled:opacity-40 disabled:pointer-events-none",
          "[-webkit-tap-highlight-color:transparent]",
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
