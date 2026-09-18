/**
 * Pulse Office Layout & Column State Management.
 *
 * Defines the 3-column grid structure (Focus, Network, Intelligence),
 * standard card IDs, default card placements, and a pure reducer
 * for manipulating user layout preferences.
 */
import type { PulseColumn, PulseLayout } from "../../../api/preferences";

export type { PulseColumn, PulseLayout };

export const PULSE_COLUMNS: readonly PulseColumn[] = [
  "focus",
  "network",
  "intel",
] as const;

export const PULSE_CARD_IDS = [
  "up-next",
  "completed",
  "activity",
  "momentum",
  "composition",
  "insight",
  "inbox",
  "coming-up",
  "new-people",
] as const;

export type PulseCardId = (typeof PULSE_CARD_IDS)[number];

export const KNOWN_PULSE_CARD_IDS: ReadonlySet<string> = new Set(
  PULSE_CARD_IDS,
);

export const MAX_CARDS_PER_COL = 20;

export const DEFAULT_COLUMN_CARDS: Record<PulseColumn, PulseCardId[]> = {
  focus: ["up-next", "completed"],
  network: ["activity", "momentum", "composition"],
  intel: ["insight", "inbox", "coming-up", "new-people"],
};

export const DEFAULT_PULSE_LAYOUT: PulseLayout = {
  hidden: [],
  order: {
    focus: [...DEFAULT_COLUMN_CARDS.focus],
    network: [...DEFAULT_COLUMN_CARDS.network],
    intel: [...DEFAULT_COLUMN_CARDS.intel],
  },
};

export function getDefaultColumnForCard(cardId: string): PulseColumn {
  for (const col of PULSE_COLUMNS) {
    if ((DEFAULT_COLUMN_CARDS[col] as readonly string[]).includes(cardId)) {
      return col;
    }
  }
  return "focus";
}

export interface ResolvedLayout {
  visible: Record<PulseColumn, PulseCardId[]>;
  hidden: PulseCardId[];
}

/**
 * Resolves a raw layout against known card IDs and defaults.
 *
 * - Drops unknown card IDs
 * - Drops duplicate IDs
 * - Caps at 20 items
 * - Restores unplaced known cards (that are not hidden) to their default column
 */
export function resolveLayout(raw?: PulseLayout | null): ResolvedLayout {
  if (!raw) {
    return {
      visible: {
        focus: [...DEFAULT_COLUMN_CARDS.focus],
        network: [...DEFAULT_COLUMN_CARDS.network],
        intel: [...DEFAULT_COLUMN_CARDS.intel],
      },
      hidden: [],
    };
  }

  // 1. Sanitize hidden list (known only, unique, capped at 20)
  const seen = new Set<string>();
  const hidden: PulseCardId[] = [];
  for (const id of raw.hidden || []) {
    if (KNOWN_PULSE_CARD_IDS.has(id) && !seen.has(id)) {
      seen.add(id);
      hidden.push(id as PulseCardId);
      if (hidden.length >= MAX_CARDS_PER_COL) break;
    }
  }

  // 2. Resolve columns
  const visible: Record<PulseColumn, PulseCardId[]> = {
    focus: [],
    network: [],
    intel: [],
  };

  for (const col of PULSE_COLUMNS) {
    const rawIds = raw.order?.[col] ?? [];
    for (const id of rawIds) {
      if (
        KNOWN_PULSE_CARD_IDS.has(id) &&
        !seen.has(id) &&
        visible[col].length < MAX_CARDS_PER_COL
      ) {
        seen.add(id);
        visible[col].push(id as PulseCardId);
      }
    }
  }

  // 3. Any known card not yet in hidden or visible gets restored to default column
  for (const cardId of PULSE_CARD_IDS) {
    if (!seen.has(cardId)) {
      const defaultCol = getDefaultColumnForCard(cardId);
      if (visible[defaultCol].length < MAX_CARDS_PER_COL) {
        seen.add(cardId);
        visible[defaultCol].push(cardId);
      }
    }
  }

  return { visible, hidden };
}

export type PulseLayoutAction =
  | { type: "hide"; cardId: string }
  | { type: "show"; cardId: string; column?: PulseColumn }
  | {
      type: "move";
      cardId: string;
      targetColumn: PulseColumn;
      targetIndex?: number;
    }
  | { type: "reorder"; column: PulseColumn; cardIds: string[] }
  | { type: "reset" };

/**
 * Pure reducer for Pulse layout actions.
 */
export function pulseLayoutReducer(
  state: PulseLayout,
  action: PulseLayoutAction,
): PulseLayout {
  switch (action.type) {
    case "reset":
      return {
        hidden: [],
        order: {
          focus: [...DEFAULT_COLUMN_CARDS.focus],
          network: [...DEFAULT_COLUMN_CARDS.network],
          intel: [...DEFAULT_COLUMN_CARDS.intel],
        },
      };

    case "hide": {
      if (!KNOWN_PULSE_CARD_IDS.has(action.cardId)) return state;
      const { visible, hidden } = resolveLayout(state);
      if (hidden.includes(action.cardId as PulseCardId)) return state;

      // Remove from whichever visible column it's in
      const nextVisible: Record<PulseColumn, string[]> = {
        focus: visible.focus.filter((id) => id !== action.cardId),
        network: visible.network.filter((id) => id !== action.cardId),
        intel: visible.intel.filter((id) => id !== action.cardId),
      };

      const nextHidden = [...hidden, action.cardId].slice(0, MAX_CARDS_PER_COL);

      return {
        hidden: nextHidden,
        order: nextVisible,
      };
    }

    case "show": {
      if (!KNOWN_PULSE_CARD_IDS.has(action.cardId)) return state;
      const { visible, hidden } = resolveLayout(state);
      const targetCol = action.column || getDefaultColumnForCard(action.cardId);

      const nextHidden = hidden.filter((id) => id !== action.cardId);
      const colItems = visible[targetCol].filter((id) => id !== action.cardId);
      const nextVisible: Record<PulseColumn, string[]> = {
        ...visible,
        [targetCol]: [...colItems, action.cardId].slice(0, MAX_CARDS_PER_COL),
      };

      return {
        hidden: nextHidden,
        order: nextVisible,
      };
    }

    case "move": {
      if (!KNOWN_PULSE_CARD_IDS.has(action.cardId)) return state;
      const { visible, hidden } = resolveLayout(state);
      const targetCol = action.targetColumn;

      // Unhide if it was hidden
      const nextHidden = hidden.filter((id) => id !== action.cardId);

      // Remove from all visible columns
      const nextVisible: Record<PulseColumn, string[]> = {
        focus: visible.focus.filter((id) => id !== action.cardId),
        network: visible.network.filter((id) => id !== action.cardId),
        intel: visible.intel.filter((id) => id !== action.cardId),
      };

      const targetList = [...nextVisible[targetCol]];
      const targetIdx =
        action.targetIndex !== undefined
          ? Math.max(0, Math.min(action.targetIndex, targetList.length))
          : targetList.length;

      targetList.splice(targetIdx, 0, action.cardId);
      nextVisible[targetCol] = targetList.slice(0, MAX_CARDS_PER_COL);

      return {
        hidden: nextHidden,
        order: nextVisible,
      };
    }

    case "reorder": {
      const { visible, hidden } = resolveLayout(state);
      // Keep only valid known cards that belong to this column
      const sanitized = action.cardIds
        .filter((id) => KNOWN_PULSE_CARD_IDS.has(id))
        .slice(0, MAX_CARDS_PER_COL);

      return {
        hidden,
        order: {
          ...visible,
          [action.column]: sanitized,
        },
      };
    }

    default:
      return state;
  }
}
