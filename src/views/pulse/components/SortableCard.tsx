/**
 * SortableCard: one card of the Pulse grid, as dnd-kit sees it.
 *
 * The wrapper is the card's draggable and its droppable at once, under the
 * card's id. Its drag handle is the grip in the card's header (`CardFrame`),
 * which reads the attributes, the listeners and the handle's ref from the
 * customize context this component provides.
 *
 * While the card is in the air it folds to a slot (`DRAG_SLOT`): a dashed
 * box as tall as the preview under the pointer, and the card's own content
 * leaves the page until the drop. The slot is what moves through the columns,
 * so a move across columns mounts a light box and not the queue or the
 * heatmap. The preview is drawn by `PulseGrid`'s `DragOverlay`, not here.
 *
 * Nothing on the wrapper transitions. The slides between places are FLIP
 * animations on the Web Animations API (`lib/flip.ts`), started by
 * `PulseGrid`, and `data-flip-id` is how they find the card. A
 * `transition-all` here used to animate the card's own drag transform, so the
 * card trailed the pointer.
 *
 * The component is memoised, and its `children` are the page's card
 * elements, built once per change of their data. A step of the drag renders
 * the grid again and this component only where its place changed: the
 * card's content keeps the same element and React skips it.
 */
import React, { memo, useCallback, useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "../../../lib/utils";
import type { PulseCardId, PulseColumn } from "../lib/layout";
import { DRAG_SLOT } from "../lib/pulseStyles";
import { CardCustomizeContext } from "../context/CardCustomizeContext";

export interface SortableCardProps {
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
