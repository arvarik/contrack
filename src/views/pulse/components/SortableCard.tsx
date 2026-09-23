import React, { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../../lib/utils";
import type { PulseColumn } from "../lib/layout";
import { CardCustomizeContext } from "../context/CardCustomizeContext";

export interface SortableCardProps {
  cardId: string;
  column: PulseColumn;
  index: number;
  totalInColumn: number;
  isEditing: boolean;
  onHide: (cardId: string) => void;
  onMoveToColumn: (cardId: string, targetColumn: PulseColumn) => void;
  onMoveStep: (cardId: string, direction: -1 | 1) => void;
  children: React.ReactNode;
}

export const SortableCard = ({
  cardId,
  column,
  index,
  totalInColumn,
  isEditing,
  onHide,
  onMoveToColumn,
  onMoveStep,
  children,
}: SortableCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardId,
    disabled: !isEditing,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const contextValue = useMemo(
    () => ({
      isEditing,
      column,
      index,
      totalInColumn,
      attributes,
      listeners,
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
      onHide,
      onMoveToColumn,
      onMoveStep,
    ],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-2xl transition-all",
        isDragging &&
          "opacity-60 bg-primary/5 shadow-xl ring-2 ring-primary/30",
      )}
    >
      <CardCustomizeContext.Provider value={contextValue}>
        {children}
      </CardCustomizeContext.Provider>
    </div>
  );
};
