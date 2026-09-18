import React from "react";
import { cn } from "../../../lib/utils";
import { CARD, CARD_COMPACT } from "../../../lib/styles";
import { LucideIcon } from "lucide-react";

export interface CardFrameProps {
  id?: string;
  cardId?: string;
  title: string;
  icon?: LucideIcon;
  count?: number;
  badge?: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  compact?: boolean;
}

export const CardFrame = ({
  id,
  cardId,
  title,
  icon: Icon,
  count,
  badge,
  headerAction,
  children,
  className,
  headerClassName,
  compact = false,
}: CardFrameProps) => {
  const headingId = id || (cardId ? `card-heading-${cardId}` : undefined);

  return (
    <section
      aria-labelledby={headingId}
      data-card-id={cardId}
      className={cn(
        compact ? CARD_COMPACT : CARD,
        "flex flex-col relative overflow-hidden transition-all duration-200",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 p-4 sm:p-5 pb-3 border-b border-outline/10",
          headerClassName,
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <Icon className="w-4 h-4 text-primary shrink-0 opacity-85" />
          )}
          <h2
            id={headingId}
            className="text-sm sm:text-base font-bold text-on-surface truncate tracking-tight"
          >
            {title}
          </h2>
          {count !== undefined && (
            <span
              className={cn(
                "inline-flex items-center justify-center text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums",
                count > 0
                  ? "bg-primary/10 text-primary"
                  : "bg-surface-container-high text-on-surface-variant",
              )}
            >
              {count}
            </span>
          )}
          {badge}
        </div>
        {headerAction && (
          <div className="flex items-center gap-2 shrink-0">{headerAction}</div>
        )}
      </div>

      <div className="flex-1 p-4 sm:p-5">{children}</div>
    </section>
  );
};
