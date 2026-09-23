/**
 * EmptyState — what a screen shows when it has nothing to show.
 *
 * The review counted seven empty-state styles: a tinted square with a Users
 * icon, a party icon in a 96 px circle, a green check, a grey card, a faint
 * icon, a grey square with "No matches found", a waveform, and a brain hero.
 * Each said the same thing a different way. This is the one way.
 *
 *   ┌────┐
 *   │ ◇  │   icon tile, 48 px, primary wash (or the illustration)
 *   └────┘
 *   Title            16 px bold
 *   One sentence.    14 px
 *   [ Action ]       at most one .btn-primary
 *
 * One action at most, so the prop is one object and not a node: a second
 * button cannot be passed in. The `illustration` slot replaces the icon tile
 * and is what the corvid plan fills with the mark where it fits.
 *
 * The title is an h2 by default, which is right for a page whose h1 is the
 * page name. Inside a card whose own title is an h2, pass `level={3}` so the
 * heading order does not skip or repeat.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { TONE_WASH, type Tone } from "../../lib/styles";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** An icon before the label. Decorative. */
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  /** The icon in the 48 px tile. Ignored when `illustration` is given. */
  icon?: LucideIcon;
  /** A node drawn in place of the icon tile. The corvid mark goes here. */
  illustration?: ReactNode;
  title: string;
  /** One sentence. */
  body: ReactNode;
  action?: EmptyStateAction;
  /** 2 on a page, 3 inside a card that has its own h2. */
  level?: 2 | 3;
  /**
   * The icon tile's tone. `primary` (the default) for an empty place, `error`
   * for a place that failed to load.
   */
  tone?: Tone;
  className?: string;
}

export const EmptyState = ({
  icon: Icon,
  illustration,
  title,
  body,
  action,
  level = 2,
  tone = "primary",
  className,
}: EmptyStateProps) => {
  const Heading = level === 3 ? "h3" : "h2";
  const ActionIcon = action?.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center text-center px-6 py-10 gap-3",
        className,
      )}
    >
      {illustration ??
        (Icon && (
          <div
            data-testid="empty-state-icon"
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center",
              TONE_WASH[tone],
            )}
          >
            <Icon className="w-6 h-6" aria-hidden="true" />
          </div>
        ))}
      <Heading className="text-base font-headline font-bold text-on-surface">
        {title}
      </Heading>
      <p className="text-sm text-on-surface-variant max-w-sm">{body}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn-primary mt-1"
        >
          {ActionIcon && <ActionIcon className="w-4 h-4" aria-hidden="true" />}
          {action.label}
        </button>
      )}
    </div>
  );
};
