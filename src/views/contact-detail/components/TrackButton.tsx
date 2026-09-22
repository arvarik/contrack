/**
 * TrackButton: the one control that says whether a person keeps up with
 * this contact.
 *
 * A toggle button with `aria-pressed`, the Radar glyph and one word: Track
 * when off, Tracked when on. Off, it is `.btn-secondary`. On, it takes the
 * primary wash the "New" button wears and the glyph takes the accent, so
 * the state is told by the word, the wash and the colour. Both keep the
 * 44 px box from `hit-area`.
 *
 * The narrow header has room for the glyph alone: the word moves into the
 * accessible name and the tooltip.
 *
 * Pressing it runs `useTrackToggle`, which toasts with an Undo. The ring
 * around the avatar appears or goes with the flag, because both read the
 * same contact. The "Contact actions" menu gets no Track item: one control
 * per concept.
 */
import { Radar } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  useTrackToggle,
  type TrackableContact,
} from "../../../hooks/useTrackToggle";

export interface TrackButtonProps {
  contact: TrackableContact;
  /** The narrow header: the glyph alone, with the word in the name. */
  compact?: boolean;
  className?: string;
}

/** The primary wash of the on state, as the "New" button wears it. */
const ON =
  "bg-primary/10 text-on-primary-wash hover:bg-primary/20 transition-colors disabled:opacity-50";

export const TrackButton = ({
  contact,
  compact = false,
  className,
}: TrackButtonProps) => {
  const { toggle, isPending } = useTrackToggle();
  const on = contact.isTracked;
  const word = on ? "Tracked" : "Track";

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={compact ? word : undefined}
      title={compact ? word : undefined}
      disabled={isPending}
      onClick={() => toggle(contact)}
      className={cn(
        compact
          ? cn(
              "hit-area p-2 rounded-md flex items-center justify-center",
              on
                ? ON
                : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50",
            )
          : on
            ? cn(
                "hit-area inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-5 py-2 rounded-md text-sm font-bold",
                ON,
              )
            : "btn-secondary",
        className,
      )}
    >
      <Radar
        aria-hidden="true"
        className={cn("w-4 h-4 shrink-0", on && "text-primary")}
      />
      {!compact && word}
    </button>
  );
};
