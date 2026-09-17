/**
 * ComposerPlaceholder — what stands in while the composer's chunk loads.
 *
 * The composer pulls in TipTap and ProseMirror, which together dominate the
 * contact detail bundle. Loading it lazily takes that weight off the critical
 * path for the app's most-visited screen, but a lazy boundary is only an
 * improvement if the placeholder is the *same shape* as what replaces it.
 * A spinner, or nothing, would make the timeline below jump the moment the
 * editor mounted, which trades a slow screen for a janky one.
 *
 * So this mirrors the composer's real geometry, in both its forms: the same
 * editor area height, the same next-action row, the same action bar with the
 * type control on the left and Save on the right. The swap is invisible apart
 * from the text becoming typeable.
 *
 * It is also deliberately inert rather than a fake input. Focusing a textarea
 * that is about to be replaced would steal the caret and then lose it mid
 * keystroke. A placeholder that quietly cannot be typed into for ~100ms is
 * better than one that accepts a keystroke and drops it.
 */
import React from "react";
import { CalendarClock } from "lucide-react";
import { COMPOSER } from "../lib/styles";
import { cn } from "../lib/utils";

export const ComposerPlaceholder = ({
  compact = false,
}: {
  /** The quick interaction dialog's form, with no card around it. */
  compact?: boolean;
}) => (
  <div
    className={
      compact
        ? "flex flex-col"
        : cn(COMPOSER, "p-0 overflow-hidden flex flex-col shadow-md")
    }
    aria-busy="true"
    aria-label="Loading the note composer"
  >
    {/* Editor area — matches the composer's padding and typing height. */}
    <div className={cn("flex-1", compact ? "px-5 pt-2" : "p-5")}>
      {/* 80px matches the editor's own `min-h-[80px]` prose class exactly,
          so the swap is a pixel-for-pixel replacement. */}
      <div
        className={cn(
          "min-h-[80px] flex items-start pt-1",
          compact && "bg-surface-container-low rounded-xl px-3 py-2",
        )}
      >
        <span className="text-on-surface-variant text-sm">
          Write a quick note...
        </span>
      </div>

      {/* Next-action row */}
      <div className="mt-4 flex items-center">
        <div className="flex flex-1 items-center min-h-[44px] sm:min-h-0 px-3 sm:py-2.5 bg-surface-container-lowest rounded-xl shadow-sm">
          <CalendarClock className="w-4 h-4 text-primary mr-2.5 shrink-0" />
          <span className="text-xs font-semibold text-on-surface-variant">
            Next action (e.g. Follow up next Tuesday at 2pm)...
          </span>
        </div>
      </div>
    </div>

    {/* Action bar: the type control's trough, then Save. */}
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        compact
          ? "px-5 py-3.5 mt-4 bg-surface-container-low"
          : "bg-surface-container-low/40 px-5 py-3",
      )}
    >
      <div className="h-[52px] sm:h-9 w-[184px] sm:w-[260px] rounded-full bg-surface-container/60" />
      <div className="w-24 h-11 sm:h-10 rounded-xl bg-surface-container/60" />
    </div>
  </div>
);
