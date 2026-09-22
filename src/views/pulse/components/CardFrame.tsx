/**
 * CardFrame: a title and a body, in one of two shapes.
 *
 * `card` is the section every Pulse card sits in: the card surface, a header
 * row with the `h2`, the muted count after it, a badge and a header action,
 * and the body under it. There is no line between the header and the body.
 * The header used to draw a hairline and an icon, and with nine cards that
 * read as nine identical kits. A card is a title and a body.
 *
 * `line` is for a card with nothing to show: the title, the count and one
 * sentence on one row, on the page surface, with no card background. Nobody
 * reads a framed box that says nothing. The customize controls sit at the
 * end of the row in both shapes, in the same order with the same names, so
 * the customize journeys work on a line as on a card.
 *
 * The count is inside the `h2` after a screen-reader-only comma, so the
 * section is named "Up next, 10" and a sighted reader sees the number in
 * muted text after the title.
 */
import React from "react";
import { cn } from "../../../lib/utils";
import { CARD, CARD_COMPACT } from "../../../lib/styles";
import { GripVertical, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { PULSE_TYPE } from "../lib/pulseStyles";
import {
  useCardCustomize,
  type CardCustomizeContextValue,
} from "../context/CardCustomizeContext";

export type CardFrameVariant = "card" | "line";

export interface CardFrameProps {
  id?: string;
  cardId?: string;
  title: string;
  count?: number;
  badge?: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  compact?: boolean;
  /** `card` (default) is the framed section. `line` is one row on the page surface. */
  variant?: CardFrameVariant;
}

const CONTROL_BTN =
  "hit-area p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/**
 * The customize controls: the phone arrows, the drag handle, the eye and
 * the Move to menu. Rendered by both variants in this order, with these
 * names.
 */
const CustomizeControls = ({
  title,
  cardId,
  customize,
  className,
}: {
  title: string;
  cardId: string;
  customize: CardCustomizeContextValue;
  className?: string;
}) => {
  const moveActions: ActionMenuItem[] = [];
  if (customize.column && customize.onMoveToColumn) {
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

  const atTop = customize.index === 0;
  const atBottom = customize.index === (customize.totalInColumn ?? 1) - 1;

  return (
    <div
      className={cn("flex items-center gap-1 sm:gap-1.5 shrink-0", className)}
    >
      {/* Phone Move Up & Move Down */}
      <div className="flex sm:hidden items-center gap-0.5">
        <button
          type="button"
          aria-disabled={atTop}
          onClick={() => !atTop && customize.onMoveStep?.(cardId, -1)}
          aria-label={`Move ${title} up`}
          title={atTop ? `${title} is already at the top` : `Move ${title} up`}
          className={cn(
            CONTROL_BTN,
            atTop ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-disabled={atBottom}
          onClick={() => !atBottom && customize.onMoveStep?.(cardId, 1)}
          aria-label={`Move ${title} down`}
          title={
            atBottom
              ? `${title} is already at the bottom`
              : `Move ${title} down`
          }
          className={cn(
            CONTROL_BTN,
            atBottom ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
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
        className={cn(
          CONTROL_BTN,
          "hidden sm:inline-flex items-center justify-center cursor-grab active:cursor-grabbing touch-none",
        )}
        {...customize.attributes}
        {...customize.listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Eye toggle to hide */}
      <button
        type="button"
        onClick={() => customize.onHide?.(cardId)}
        aria-label={`Hide ${title}`}
        title={`Hide ${title}`}
        className={cn(CONTROL_BTN, "cursor-pointer")}
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
  );
};

export const CardFrame = ({
  id,
  cardId,
  title,
  count,
  badge,
  headerAction,
  children,
  className,
  headerClassName,
  compact = false,
  variant = "card",
}: CardFrameProps) => {
  const customize = useCardCustomize();
  const headingId = id || (cardId ? `card-heading-${cardId}` : undefined);

  // Check if customize mode is active for this card
  const isCustomizing = customize.isEditing && Boolean(cardId);

  const heading = (
    <h2 id={headingId} className={cn(PULSE_TYPE.cardTitle, "min-w-0")}>
      {title}
      {count !== undefined && (
        <>
          <span className="sr-only">, </span>
          <span className={cn(PULSE_TYPE.cardCount, "ml-1.5")}>{count}</span>
        </>
      )}
    </h2>
  );

  if (variant === "line") {
    return (
      <section
        aria-labelledby={headingId}
        data-card-id={cardId}
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 rounded-2xl transition-all duration-200",
          isCustomizing && "ring-1 ring-primary/20",
          className,
        )}
      >
        {heading}
        {badge}
        <div className={cn(PULSE_TYPE.meta, "min-w-0")}>{children}</div>
        {headerAction}
        {isCustomizing && cardId && (
          <CustomizeControls
            title={title}
            cardId={cardId}
            customize={customize}
            className="ml-auto"
          />
        )}
      </section>
    );
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
          "flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3",
          headerClassName,
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {heading}
          {badge}
        </div>

        {isCustomizing && cardId ? (
          <CustomizeControls
            title={title}
            cardId={cardId}
            customize={customize}
          />
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
