import { createContext, useContext } from "react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { PulseColumn } from "../lib/layout";

/**
 * What a card's frame needs to draw its customize controls. `SortableCard`
 * provides it around each card, and outside customize mode a card sees the
 * default, `isEditing: false`, and draws no controls.
 */
export interface CardCustomizeContextValue {
  isEditing: boolean;
  column?: PulseColumn;
  index?: number;
  totalInColumn?: number;
  /** The drag handle's attributes and listeners, from dnd-kit. */
  attributes?: DraggableAttributes;
  listeners?: SyntheticListenerMap;
  /**
   * The handle's element, for dnd-kit: keyboard focus returns to it after a
   * keyboard drag, in the card's new place.
   */
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  /**
   * A press on the handle that has not become a drag yet: a finger still
   * inside the hold, or a mouse button before the pointer has moved. The
   * handle shows it, so a person knows to hold on.
   */
  isPending?: boolean;
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
