import React from "react";
import { cn } from "../../lib/utils";
import { CARD_COMPACT, LABEL_PRIMARY } from "../../lib/styles";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  /** CSS entrance delay from `tileDelay(index)`. */
  delay?: string;
  highlight?: boolean;
  onClick?: () => void;
}

export const MetricCard = ({
  label,
  value,
  subValue,
  icon: Icon,
  delay,
  highlight = false,
  onClick,
}: MetricCardProps) => {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      onClick={onClick}
      style={{ animationDelay: delay }}
      className={cn(
        CARD_COMPACT,
        "tile-enter flex flex-col relative text-left overflow-hidden group",
        // Only the interactive affordances transition — a blanket
        // `transition-all` also animates the entrance's final frame, which
        // double-renders the tile settling into place.
        "transition-[transform,box-shadow] duration-200",
        // Reserve the tile's height up front so the row does not resize when
        // the numbers land. Matches the skeleton's 8rem on desktop; tighter on
        // phones, where the three tiles stack and the extra air just costs
        // scrolling.
        "min-h-[6rem] sm:min-h-[8rem]",
        highlight && "ring-1 ring-primary/20 bg-primary/[0.02]",
        onClick &&
          "cursor-pointer hover:-translate-y-1 hover:shadow-md hover:ring-2 hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <span
          className={cn(
            LABEL_PRIMARY,
            highlight ? "text-primary" : "text-on-surface-variant",
          )}
        >
          {label}
        </span>
        <div
          className={cn(
            "p-1.5 rounded-lg transition-colors duration-300 shrink-0",
            highlight
              ? "bg-primary/10 text-primary"
              : "bg-surface-container text-on-surface-variant group-hover:bg-surface-container-high",
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "text-3xl font-headline font-bold tabular-nums",
            highlight ? "text-primary" : "text-on-surface",
          )}
        >
          {value}
        </span>
        {subValue && (
          <span className="text-xs font-bold text-on-surface-variant">
            {subValue}
          </span>
        )}
      </div>

      {highlight && (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
      )}
    </Component>
  );
};
