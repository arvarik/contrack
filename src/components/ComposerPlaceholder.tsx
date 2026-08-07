/**
 * ComposerPlaceholder — what stands in while the rich composer's chunk loads.
 *
 * The composer pulls in TipTap and ProseMirror, which together dominate the
 * contact detail bundle. Loading it lazily takes that weight off the critical
 * path for the app's most-visited screen — but a lazy boundary is only an
 * improvement if the placeholder is the *same shape* as what replaces it.
 * A spinner, or nothing, would make the timeline below jump the moment the
 * editor mounted, which trades a slow screen for a janky one.
 *
 * So this mirrors the composer's real geometry: the same card, the same
 * editor area height, the same next-action row, the same action bar. The swap
 * is invisible apart from the text becoming typeable.
 *
 * It is also deliberately inert rather than a fake input. Focusing a textarea
 * that is about to be replaced would steal the caret and then lose it mid
 * keystroke; a placeholder that quietly cannot be typed into for ~100ms is
 * better than one that accepts a keystroke and drops it.
 */
import React from "react";
import { CalendarClock } from "lucide-react";
import { COMPOSER } from "../lib/styles";
import { cn } from "../lib/utils";

export const ComposerPlaceholder = () => (
  <div
    className={cn(COMPOSER, "p-0 overflow-hidden flex flex-col shadow-md")}
    aria-busy="true"
    aria-label="Loading the note composer"
  >
    {/* Editor area — matches the composer's p-5 and minimum typing height. */}
    <div className="p-5 flex-1">
      {/* 80px matches the editor's own `min-h-[80px]` prose class exactly,
          so the swap is a pixel-for-pixel replacement. */}
      <div className="min-h-[80px] flex items-start pt-1">
        <span className="text-on-surface-variant text-sm">
          Write a quick note...
        </span>
      </div>

      {/* Next-action row */}
      <div className="mt-4 flex items-center">
        <div className="flex flex-1 items-center px-3 py-2.5 bg-surface-container-lowest rounded-xl shadow-sm">
          <CalendarClock className="w-4 h-4 text-primary mr-2.5 shrink-0" />
          <span className="text-xs font-semibold text-on-surface-variant">
            Next Action (e.g. Follow up next Tuesday at 2pm)...
          </span>
        </div>
      </div>
    </div>

    {/* Action bar */}
    <div className="bg-surface-container-low/40 px-5 py-3 flex items-center justify-between">
      <div className="flex gap-1.5 bg-surface-container-lowest p-1 rounded-xl shadow-sm">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="w-9 h-9 rounded-lg bg-surface-container/60" />
        ))}
      </div>
      <div className="w-24 h-10 rounded-full bg-surface-container/60" />
    </div>
  </div>
);
