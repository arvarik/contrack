import { createContext, useContext } from "react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { PulseColumn } from "../lib/layout";

export interface CardCustomizeContextValue {
  isEditing: boolean;
  column?: PulseColumn;
  index?: number;
  totalInColumn?: number;
  attributes?: DraggableAttributes;
  listeners?: SyntheticListenerMap;
  onHide?: (cardId: string) => void;
  onMoveToColumn?: (cardId: string, targetColumn: PulseColumn) => void;
  onMoveStep?: (cardId: string, direction: -1 | 1) => void;
}

const defaultContext: CardCustomizeContextValue = {
  isEditing: false,
};

export const CardCustomizeContext =
  createContext<CardCustomizeContextValue>(defaultContext);

export const useCardCustomize = () => useContext(CardCustomizeContext);
