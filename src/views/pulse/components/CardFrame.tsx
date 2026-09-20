import React from "react";
import { cn } from "../../../lib/utils";
import { CARD, CARD_COMPACT } from "../../../lib/styles";
import {
  GripVertical,
  EyeOff,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { useCardCustomize } from "../context/CardCustomizeContext";

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
  const customize = useCardCustomize();
  const headingId = id || (cardId ? `card-heading-${cardId}` : undefined);

  // Check if customize mode is active for this card
  const isCustomizing = customize.isEditing && Boolean(cardId);

  const moveActions: ActionMenuItem[] = [];
  if (isCustomizing && customize.column && customize.onMoveToColumn && cardId) {
    if (customize.column !== "focus") {
      moveActions.push({
        id: "move-focus",
        label: "Move to Focus",
        onSelect: () => customize.onMoveToColumn?.(cardId, "focus"),
      });
    }
    if (customize.column !== "network") {
      moveActions.push({
        id: "move-network",
        label: "Move to Network",
        onSelect: () => customize.onMoveToColumn?.(cardId, "network"),
      });
    }
    if (customize.column !== "intel") {
      moveActions.push({
        id: "move-intel",
        label: "Move to Intelligence",
        onSelect: () => customize.onMoveToColumn?.(cardId, "intel"),
      });
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-card-id={cardId}
      className={cn(
        compact ? CARD_COMPACT : CARD,
        "flex flex-col relative overflow-hidden transition-all duration-200",
        isCustomizing && "ring-1 ring-primary/20",
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
                "inline-flex items-center justify-center text-xs font-semibold px-2 py-0.5 rounded-md tabular-nums",
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

        {isCustomizing ? (
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Phone Move Up & Move Down */}
            <div className="flex sm:hidden items-center gap-0.5">
              <button
                type="button"
                aria-disabled={customize.index === 0}
                onClick={() =>
                  customize.index !== 0 &&
                  cardId &&
                  customize.onMoveStep?.(cardId, -1)
                }
                aria-label={`Move ${title} up`}
                title={
                  customize.index === 0
                    ? `${title} is already at the top`
                    : `Move ${title} up`
                }
                className={cn(
                  "hit-area p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  customize.index === 0
                    ? "opacity-30 cursor-not-allowed"
                    : "cursor-pointer",
                )}
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-disabled={
                  customize.index === (customize.totalInColumn ?? 1) - 1
                }
                onClick={() =>
                  customize.index !== (customize.totalInColumn ?? 1) - 1 &&
                  cardId &&
                  customize.onMoveStep?.(cardId, 1)
                }
                aria-label={`Move ${title} down`}
                title={
                  customize.index === (customize.totalInColumn ?? 1) - 1
                    ? `${title} is already at the bottom`
                    : `Move ${title} down`
                }
                className={cn(
                  "hit-area p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  customize.index === (customize.totalInColumn ?? 1) - 1
                    ? "opacity-30 cursor-not-allowed"
                    : "cursor-pointer",
                )}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Desktop Drag Handle */}
            <button
              type="button"
              aria-label={`Drag ${title} to reorder`}
              title={`Drag ${title} to reorder`}
              className="hidden sm:inline-flex items-center justify-center hit-area p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface cursor-grab active:cursor-grabbing touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              {...customize.attributes}
              {...customize.listeners}
            >
              <GripVertical className="w-4 h-4" />
            </button>

            {/* Eye toggle to hide */}
            <button
              type="button"
              onClick={() => cardId && customize.onHide?.(cardId)}
              aria-label={`Hide ${title}`}
              title={`Hide ${title}`}
              className="hit-area p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <EyeOff className="w-4 h-4" />
            </button>

            {/* Column ActionMenu */}
            {moveActions.length > 0 && (
              <ActionMenu
                label={`Move ${title}`}
                items={moveActions}
                iconClassName="w-4 h-4"
              />
            )}
          </div>
        ) : (
          headerAction && (
            <div className="flex items-center gap-2 shrink-0">
              {headerAction}
            </div>
          )
        )}
      </div>

      <div className="flex-1 p-4 sm:p-5">{children}</div>
    </section>
  );
};
