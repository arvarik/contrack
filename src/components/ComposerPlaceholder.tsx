/**
 * What stands in while the composer's chunk (TipTap and ProseMirror) loads.
 * It has the composer's shape in both its forms, so the timeline below does
 * not jump when the editor mounts.
 *
 * Inert, not a fake input: a field about to be replaced would drop a
 * keystroke typed into it.
 */
import { CalendarClock } from "lucide-react";
import { COMPOSER } from "../lib/styles";
import { cn } from "../lib/utils";

export const ComposerPlaceholder = ({
  compact = false,
  collapsed = false,
}: {
  /** The quick interaction dialog's form, with no card around it. */
  compact?: boolean;
  /** The narrow contact layout's composer, which opens as one line. */
  collapsed?: boolean;
}) =>
  collapsed ? (
    <div
      className={cn(COMPOSER, "p-0 overflow-hidden flex flex-col")}
      aria-busy="true"
      aria-label="Loading the note composer"
    >
      {/* The editor's own type and margins, so the line is as tall as the
          loaded composer's (`composer-line`). The variant ink, not faded:
          text on screen must pass contrast. */}
      <div className="composer-line px-5 py-3 prose prose-sm max-w-none text-base sm:text-sm prose-p:my-1">
        <p className="text-on-surface-variant">Write a quick note…</p>
      </div>
    </div>
  ) : (
    <div
      className={
        compact
          ? "flex flex-col"
          : cn(COMPOSER, "p-0 overflow-hidden flex flex-col")
      }
      aria-busy="true"
      aria-label="Loading the note composer"
    >
      {/* Editor area: the composer's padding and typing height. */}
      <div className={cn("flex-1", compact ? "px-5 pt-2" : "p-5")}>
        {/* 80px matches the editor's own `min-h-[80px]`. */}
        <div
          className={cn(
            "min-h-[80px] flex items-start pt-1",
            compact && "bg-surface-container-low rounded-xl px-3 py-2",
          )}
        >
          <span className="text-on-surface-variant text-sm">
            Write a quick note…
          </span>
        </div>

        {/* Follow-up row */}
        <div className="mt-4 flex items-center">
          <div className="flex flex-1 items-center min-h-[44px] sm:pointer-fine:min-h-0 px-3 sm:py-2.5 bg-surface-container-lowest rounded-xl shadow-sm">
            <CalendarClock className="w-4 h-4 text-primary mr-2.5 shrink-0" />
            <span className="text-xs font-semibold text-on-surface-variant">
              Follow-up, like call back Tuesday
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
