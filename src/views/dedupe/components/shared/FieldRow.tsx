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
  <div
    className={`flex items-center gap-2.5 ${
      conflict
        ? "bg-amber-500/15 border border-amber-500/30 rounded-lg px-2.5 py-1.5 -mx-1"
        : highlighted
          ? "bg-amber-500/8 rounded-lg px-2.5 py-1.5 -mx-1"
          : ""
    }`}
  >
    <span className="text-on-surface-variant shrink-0">{icon}</span>
    <span className={cn(LABEL, "w-16 shrink-0")}>{label}</span>
    <span className="text-on-surface flex-1 min-w-0">{children}</span>
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
