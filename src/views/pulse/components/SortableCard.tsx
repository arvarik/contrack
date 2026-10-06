/**
 * One card of the Pulse grid, its draggable and droppable at once. The grip
 * in `CardFrame` reads the drag handle from the customize context this
 * provides. In the air the card folds to a slot (`DRAG_SLOT`), so a move
 * across columns mounts a light box, not the queue or the heatmap.
 *
 * Nothing on the wrapper transitions: `PulseGrid` runs FLIP slides
 * (`lib/flip.ts`) found by `data-flip-id`, and a CSS transition here would
 * make the card trail the pointer. It is memoized, so a drag step renders
 * only the cards whose place changed.
 */
import React, { memo, useCallback, useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "../../../lib/utils";
import type { PulseCardId, PulseColumn } from "../lib/layout";
import { DRAG_SLOT } from "../lib/pulseStyles";
import { CardCustomizeContext } from "../context/CardCustomizeContext";

interface SortableCardProps {
  cardId: PulseCardId;
  column: PulseColumn;
  index: number;
  totalInColumn: number;
  isEditing: boolean;
  /** A press on this card's handle is waiting to become a drag. */
  isPending?: boolean;
  onHide: (cardId: string) => void;
  onMoveToColumn: (cardId: string, targetColumn: PulseColumn) => void;
  onMoveStep: (cardId: string, direction: -1 | 1) => void;
  children: React.ReactNode;
}

/** How the handle names itself to a screen reader, after its label. */
const ROLE_DESCRIPTION = { roleDescription: "draggable card" };

export const SortableCard = memo(function SortableCard({
  cardId,
  column,
  index,
  totalInColumn,
  isEditing,
  isPending = false,
  onHide,
  onMoveToColumn,
  onMoveStep,
  children,
}: SortableCardProps) {
  const data = useMemo(() => ({ column }), [column]);
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({
    id: cardId,
    data,
    disabled: !isEditing,
    attributes: ROLE_DESCRIPTION,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: cardId,
    data,
    disabled: !isEditing,
  });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef],
  );

  const contextValue = useMemo(
    () => ({
      isEditing,
      column,
      index,
      totalInColumn,
      attributes,
      listeners,
      setActivatorNodeRef,
      isPending,
      onHide,
      onMoveToColumn,
      onMoveStep,
    }),
    [
      isEditing,
      column,
      index,
      totalInColumn,
      attributes,
      listeners,
      setActivatorNodeRef,
      isPending,
      onHide,
      onMoveToColumn,
      onMoveStep,
    ],
  );

  return (
    <div
      ref={setNodeRef}
      data-flip-id={cardId}
      className={cn("relative rounded-2xl", isDragging && DRAG_SLOT)}
    >
      {!isDragging && (
        <CardCustomizeContext.Provider value={contextValue}>
          {children}
        </CardCustomizeContext.Provider>
      )}
    </div>
  );
});
