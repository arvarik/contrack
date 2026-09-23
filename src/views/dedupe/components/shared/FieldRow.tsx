import React from "react";
import { LABEL, TONE_WASH } from "../../../../lib/styles";
import { cn } from "../../../../lib/utils";

// =============================================================================
// FieldRow — A single labeled field row with optional diff highlight
// =============================================================================

export interface FieldRowProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  highlighted?: boolean;
  conflict?: boolean;
  conflictLabel?: string;
}

export const FieldRow = ({
  icon,
  label,
  children,
  highlighted,
  conflict,
  conflictLabel,
}: FieldRowProps) => (
  // A value that differs wears the warning tone's wash, and a conflict a
  // step more of it. No border and no raw amber: the tone says it. The
  // wash's inset and its negative margin are the same 8 px, so the icon and
  // the label stay in the column of the rows without a wash, and the wash
  // ends where the name's wash above it ends (`DIFF_WASH` in ContactCard).
  <div
    className={cn(
      "flex items-center gap-2.5",
      (conflict || highlighted) && "rounded-lg px-2 py-1.5 -mx-2",
      conflict ? "bg-warning/10" : highlighted && "bg-warning/5",
    )}
  >
    <span className="text-on-surface-variant shrink-0">{icon}</span>
    <span className={cn(LABEL, "w-16 shrink-0")}>{label}</span>
    {/* A long email wraps rather than running past the card's edge. */}
    <span className="text-on-surface flex-1 min-w-0 break-words">
      {children}
    </span>
    {conflictLabel && (
      <span
        className={cn(
          "shrink-0 text-[11px] uppercase tracking-[0.08em] font-bold px-1.5 py-0.5 rounded",
          conflictLabel.toLowerCase().includes("kept")
            ? TONE_WASH.success
            : TONE_WASH.warning,
        )}
      >
        {conflictLabel}
      </span>
    )}
  </div>
);
