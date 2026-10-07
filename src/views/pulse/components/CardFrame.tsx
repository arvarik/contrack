/**
 * CardFrame: a title and a body, as a `card` (the framed section) or a `line`
 * (one row on the page surface, for a card with nothing to show).
 *
 * Both shapes put the customize controls at the end of the title's row, in
 * the same order with the same names, and neither changes height when they
 * appear. The count sits in the `h2` after a screen-reader-only comma, so
 * the section is named "Up next, 10".
 */
import React from "react";
import { cn } from "../../../lib/utils";
import { CARD } from "../../../lib/styles";
import { GripVertical, EyeOff } from "lucide-react";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { PULSE_TYPE } from "../lib/pulseStyles";
import { COLUMN_NAMES, PULSE_COLUMNS } from "../lib/layout";
import {
  useCardCustomize,
  type CardCustomizeContextValue,
} from "../context/CardCustomizeContext";

type CardFrameVariant = "card" | "line";

interface CardFrameProps {
  cardId?: string;
  title: string;
  count?: number;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  variant?: CardFrameVariant;
}

const CONTROL_BTN =
  "hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors";

/**
 * The drag handle. `touch-manipulation`, not `touch-none`, leaves the browser
 * its pan, so a flick that starts on the handle still scrolls the page.
 */
const GRIP_BTN =
  "inline-flex items-center justify-center cursor-grab active:cursor-grabbing touch-manipulation select-none [-webkit-touch-callout:none]";

/**
 * The drag handle, the eye and the Move menu. The Move menu moves a card
 * without a drag, at every width.
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
  const index = customize.index ?? 0;
  const total = customize.totalInColumn ?? 1;
  if (customize.onMoveStep) {
    if (index > 0) {
      moveActions.push({
        id: "move-up",
        label: "Move up",
        onSelect: () => customize.onMoveStep?.(cardId, -1),
      });
    }
    if (index < total - 1) {
      moveActions.push({
        id: "move-down",
        label: "Move down",
        onSelect: () => customize.onMoveStep?.(cardId, 1),
      });
    }
  }
  if (customize.column && customize.onMoveToColumn) {
    for (const column of PULSE_COLUMNS) {
      if (column === customize.column) continue;
      moveActions.push({
        id: `move-${column}`,
        label: `Move to ${COLUMN_NAMES[column]}`,
        onSelect: () => customize.onMoveToColumn?.(cardId, column),
      });
    }
  }

  return (
    // 12 px between the controls on a phone, so their 44 px tap boxes
    // (`hit-area`) do not overlap under a thumb.
    <div
      className={cn("flex items-center gap-3 sm:gap-1.5 shrink-0", className)}
    >
      <button
        type="button"
        ref={customize.setActivatorNodeRef}
        aria-label={`Drag ${title} to reorder`}
        title={`Drag ${title} to reorder`}
        data-pending={customize.isPending || undefined}
        className={cn(
          CONTROL_BTN,
          GRIP_BTN,
          customize.isPending && "bg-primary/10 text-primary",
        )}
        {...customize.attributes}
        {...customize.listeners}
      >
        <GripVertical className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* The tray above the grid brings a hidden card back. */}
      <button
        type="button"
        onClick={() => customize.onHide?.(cardId)}
        aria-label={`Hide ${title}`}
        title={`Hide ${title}`}
        className={cn(CONTROL_BTN, "cursor-pointer")}
      >
        <EyeOff className="w-4 h-4" />
      </button>

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
  cardId,
  title,
  count,
  headerAction,
  children,
  variant = "card",
}: CardFrameProps) => {
  const customize = useCardCustomize();
  const headingId = cardId ? `card-heading-${cardId}` : undefined;

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
          // The card's side inset, so the title lines up with the cards'.
          "relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-2 rounded-2xl transition-shadow",
          isCustomizing && "ring-1 ring-primary/20",
        )}
      >
        {heading}
        {/* In customize mode the words keep their place, invisible, and the
            controls sit over the row's end, so the line keeps its height. */}
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
            // One title line (15 px at 1.5), so the controls center on it.
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
        // No surface padding: the header and the body set the inset. With
        // both, a phone card lost 80 of its 350 px to padding.
        CARD,
        "p-0 flex flex-col relative overflow-hidden transition-shadow",
        isCustomizing && "ring-1 ring-primary/20",
      )}
    >
      {/* The header's bottom inset is the one gap between header and body. */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-4">
        {/* 24 px, the height of a header action, so every header matches. */}
        <div className="flex items-center min-w-0 min-h-6">{heading}</div>

        {isCustomizing && cardId ? (
          <CustomizeControls
            title={title}
            cardId={cardId}
            customize={customize}
            // Fits the 32 px buttons in the 24 px row, so the height holds.
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
