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
  "keeping-up",
  "activity",
  "composition",
  "insight",
  "inbox",
  "coming-up",
] as const;

export type PulseCardId = (typeof PULSE_CARD_IDS)[number];

export const KNOWN_PULSE_CARD_IDS: ReadonlySet<string> = new Set(
  PULSE_CARD_IDS,
);

export const MAX_CARDS_PER_COL = 20;

export const DEFAULT_COLUMN_CARDS: Record<PulseColumn, PulseCardId[]> = {
  focus: ["up-next", "completed"],
  // Keeping up first: the state of the people you track is the Network
  // column's headline. A stored layout that still names "momentum" or
  // "new-people" drops the id in resolveLayout, and one that does not name
  // "keeping-up" gets the card back here. Composition is last in
  // Intelligence: no other page has a home for it yet, and customize mode
  // can hide it.
  network: ["keeping-up", "activity"],
  intel: ["insight", "inbox", "coming-up", "composition"],
};

export const DEFAULT_PULSE_LAYOUT: PulseLayout = {
  hidden: [],
  order: {
    focus: [...DEFAULT_COLUMN_CARDS.focus],
    network: [...DEFAULT_COLUMN_CARDS.network],
    intel: [...DEFAULT_COLUMN_CARDS.intel],
  },
};

export const COLUMN_NAMES: Record<PulseColumn, string> = {
  focus: "Focus",
  network: "Network",
  intel: "Intelligence",
};

export const CARD_TITLES: Record<PulseCardId, string> = {
  "up-next": "Up next",
  completed: "Completed",
  "keeping-up": "Keeping up",
  activity: "Activity",
  composition: "Composition",
  insight: "Daily insight",
  inbox: "Inbox",
  "coming-up": "Coming up",
};

export function getDefaultColumnForCard(cardId: string): PulseColumn {
  for (const col of PULSE_COLUMNS) {
    if ((DEFAULT_COLUMN_CARDS[col] as readonly string[]).includes(cardId)) {
      return col;
    }
  }
  return "focus";
}

/** Each column's visible cards, in order. */
export type VisibleColumns = Record<PulseColumn, PulseCardId[]>;

export interface ResolvedLayout {
  visible: VisibleColumns;
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
  const rawHidden = Array.isArray(raw.hidden) ? raw.hidden : [];
  for (const id of rawHidden) {
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
    const rawIds = Array.isArray(raw.order?.[col]) ? raw.order[col] : [];
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

  // 3. Any known card not yet in hidden or visible gets restored to its
  //    default column, in the default order of that column. The order used
  //    to follow PULSE_CARD_IDS, so an account whose stored order was empty
  //    (the server's default preference) got Composition first in
  //    Intelligence, ahead of the insight.
  for (const col of PULSE_COLUMNS) {
    for (const cardId of DEFAULT_COLUMN_CARDS[col]) {
      if (!seen.has(cardId) && visible[col].length < MAX_CARDS_PER_COL) {
        seen.add(cardId);
        visible[col].push(cardId);
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
      const targetCol =
        action.column && PULSE_COLUMNS.includes(action.column)
          ? action.column
          : getDefaultColumnForCard(action.cardId);

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
      const targetCol = PULSE_COLUMNS.includes(action.targetColumn)
        ? action.targetColumn
        : "focus";

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
        action.targetIndex !== undefined && !Number.isNaN(action.targetIndex)
          ? Math.max(
              0,
              Math.min(Math.floor(action.targetIndex), targetList.length),
            )
          : targetList.length;

      targetList.splice(targetIdx, 0, action.cardId);
      nextVisible[targetCol] = targetList.slice(0, MAX_CARDS_PER_COL);

      return {
        hidden: nextHidden,
        order: nextVisible,
      };
    }

    case "reorder": {
      if (!PULSE_COLUMNS.includes(action.column)) return state;
      const { visible, hidden } = resolveLayout(state);
      const rawIds = Array.isArray(action.cardIds) ? action.cardIds : [];
      const seenCol = new Set<string>();
      const sanitized: PulseCardId[] = [];
      for (const id of rawIds) {
        if (KNOWN_PULSE_CARD_IDS.has(id) && !seenCol.has(id)) {
          seenCol.add(id);
          sanitized.push(id as PulseCardId);
        }
      }
      const nextHidden = hidden.filter((id) => !seenCol.has(id));
      const nextVisible: Record<PulseColumn, PulseCardId[]> = {
        focus:
          action.column === "focus"
            ? sanitized
            : visible.focus.filter((id) => !seenCol.has(id)),
        network:
          action.column === "network"
            ? sanitized
            : visible.network.filter((id) => !seenCol.has(id)),
        intel:
          action.column === "intel"
            ? sanitized
            : visible.intel.filter((id) => !seenCol.has(id)),
      };
      return {
        hidden: nextHidden,
        order: nextVisible,
      };
    }

    default:
      return state;
  }
}

// ─── The drag's draft ────────────────────────────────────────────────────────
//
// A drag in customize mode moves a card through a local copy of the visible
// columns, one step each time the drop target changes, so the target column
// opens a gap while the card is still in the air. Nothing is saved until the
// drop, and then once: `dropAction` turns the draft into one reducer action,
// and `pulseLayoutReducer` applies it to the stored preference. Escape
// throws the draft away.

/** The column that holds a card, or null when no visible column does. */
export function columnOf(
  visible: VisibleColumns,
  cardId: string,
): PulseColumn | null {
  for (const col of PULSE_COLUMNS) {
    if ((visible[col] as readonly string[]).includes(cardId)) return col;
  }
  return null;
}

/**
 * The columns with one card moved. The card leaves the column it is in and
 * goes into `targetColumn` at `targetIndex`. The index counts the target
 * column's other cards, without the card itself, and is clamped to them, so
 * 0 is the top and the column's length is the end. Pure: the other columns
 * come back as they were, in new arrays.
 */
export function moveCard(
  visible: VisibleColumns,
  cardId: PulseCardId,
  targetColumn: PulseColumn,
  targetIndex: number,
): VisibleColumns {
  const next: VisibleColumns = {
    focus: visible.focus.filter((id) => id !== cardId),
    network: visible.network.filter((id) => id !== cardId),
    intel: visible.intel.filter((id) => id !== cardId),
  };
  const list = next[targetColumn];
  const index = Math.max(
    0,
    Math.min(
      Number.isFinite(targetIndex) ? Math.floor(targetIndex) : 0,
      list.length,
    ),
  );
  list.splice(index, 0, cardId);
  return next;
}

/** Whether two sets of columns hold the same cards in the same order. */
export function sameColumns(a: VisibleColumns, b: VisibleColumns): boolean {
  return PULSE_COLUMNS.every(
    (col) =>
      a[col].length === b[col].length &&
      a[col].every((id, index) => id === b[col][index]),
  );
}

/**
 * The one reducer action that turns `before` into `after` once a drag has
 * moved `cardId`, or null when the card landed where it started. A card
 * that stayed in its column is a `reorder` of that column, and a card that
 * changed column is a `move` to its place there. The drop saves the result
 * of `pulseLayoutReducer` with this action, so a drag is one write.
 */
export function dropAction(
  before: VisibleColumns,
  after: VisibleColumns,
  cardId: PulseCardId,
): PulseLayoutAction | null {
  const from = columnOf(before, cardId);
  const to = columnOf(after, cardId);
  if (!to) return null;
  if (from === to) {
    const same =
      before[to].length === after[to].length &&
      before[to].every((id, index) => id === after[to][index]);
    return same
      ? null
      : { type: "reorder", column: to, cardIds: [...after[to]] };
  }
  return {
    type: "move",
    cardId,
    targetColumn: to,
    targetIndex: after[to].indexOf(cardId),
  };
}
