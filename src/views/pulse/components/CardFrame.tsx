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
 * end of the title's row in both shapes, in the same order with the same
 * names, so the customize journeys work on a line as on a card. Neither
 * shape changes height when they appear.
 *
 * The count is inside the `h2` after a screen-reader-only comma, so the
 * section is named "Up next, 10" and a sighted reader sees the number in
 * muted text after the title.
 */
import React from "react";
import { cn } from "../../../lib/utils";
import { CARD } from "../../../lib/styles";
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
  /** `card` (default) is the framed section. `line` is one row on the page surface. */
  variant?: CardFrameVariant;
}

/** A customize control: a flat icon button with the hover layer. */
const CONTROL_BTN =
  "hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors";

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
          // The card's own side inset, so a line's title starts on the same
          // edge as the titles of the cards above and below it.
          "relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-2 rounded-2xl transition-all",
          isCustomizing && "ring-1 ring-primary/20",
          className,
        )}
      >
        {heading}
        {badge}
        {/* In customize mode the words after the title step aside and keep
            their place, and the controls sit over the end of the title's
            row, so the line keeps its height. In the flow the controls
            took a row of their own, and every card under the line moved. */}
        <div
          className={cn(
            PULSE_TYPE.meta,
            "min-w-0",
            isCustomizing && "invisible",
          )}
        >
          {children}
        </div>
        {headerAction && isCustomizing ? (
          <span className="invisible">{headerAction}</span>
        ) : (
          headerAction
        )}
        {isCustomizing && cardId && (
          <CustomizeControls
            title={title}
            cardId={cardId}
            customize={customize}
            // One line of the title, 15 px at a line height of 1.5, below
            // the line's top inset: the controls centre on the title.
            className="absolute right-4 sm:right-5 top-2 h-[22.5px]"
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
        // The card surface without its own padding: the header and the body
        // set the inset (16 px on a phone, 20 px from sm). With both, a
        // phone card lost 80 of its 350 px to padding.
        CARD,
        "p-0 flex flex-col relative overflow-hidden transition-all",
        isCustomizing && "ring-1 ring-primary/20",
        className,
      )}
    >
      {/* The header's 16 px under the title is the one gap between header
          and body, the same step as the blocks inside a body. The body
          used to add its own top inset to it, and the title sat 32 px
          above the first row. */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-4">
        {/* The header's row is 24 px on every card, the height of a header
            action such as Manage, so a card with an action and a card
            without one have the same header. */}
        <div className="flex items-center gap-2.5 min-w-0 min-h-6">
          {heading}
          {badge}
        </div>

        {isCustomizing && cardId ? (
          <CustomizeControls
            title={title}
            cardId={cardId}
            customize={customize}
            // The buttons are 32 px. The margin fits them in the header's
            // 24 px row, so the card keeps its height when customize mode
            // turns on.
            className="-my-1"
          />
        ) : (
          headerAction && (
            <div className="flex items-center gap-2 shrink-0">
              {headerAction}
            </div>
          )
        )}
      </div>

      <div className="flex-1 px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
    </section>
  );
};
