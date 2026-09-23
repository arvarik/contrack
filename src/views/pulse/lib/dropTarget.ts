/**
 * Where a card lands in customize mode, as plain geometry.
 *
 * The drag used dnd-kit's `closestCenter` against the cards' own boxes. Up
 * next can be 800 px tall, so its centre sat 400 px from the pointer, and
 * the card the drop went to was not the card under the pointer. Here the
 * pointer decides, in two steps:
 *
 * 1. The column: the one whose width holds the pointer, the nearest one
 *    down or up from it. The empty space under a short column belongs to
 *    that column, so a card let go under Network goes to the end of
 *    Network. A pointer in the gutter between columns goes to the nearest.
 * 2. The place in that column, counted among its other cards: before the
 *    first card whose middle is below the pointer. In a card's top half the
 *    card goes before it, in its bottom half after it, whatever its height.
 *    At `lg` the Intelligence column is a grid two across, and there the
 *    order is the reading order: the row the pointer is in, then left or
 *    right of each card's middle.
 *
 * The moved card is left out of the count, and the layout it sits in
 * already holds its slot, so each move leaves the pointer a slot's height
 * past the line it crossed: a pointer that rests on a line does not make the
 * card jump back and forth.
 *
 * A place is sent to dnd-kit as the id of a droppable: the card the moved
 * card goes before, or the column itself for its end (`overIdFor`,
 * `targetFor`). The keyboard moves one place at a time (`keyboardStep`).
 * All of it is pure, so the unit tests run it without a browser.
 *
 * @module views/pulse/lib/dropTarget
 */
import {
  PULSE_COLUMNS,
  columnOf,
  type PulseCardId,
  type PulseColumn,
  type VisibleColumns,
} from "./layout";

/** A box in viewport coordinates, as dnd-kit measures one. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How a column lays out its cards: one under another, or a grid. */
export type ColumnMode = "list" | "grid";

/** A place in the columns: a column and an index among its other cards. */
export interface DropPlace {
  column: PulseColumn;
  index: number;
}

/** Tops closer than this share a row. Grid cells in one row share a top. */
const ROW_TOLERANCE = 4;

/** The id of a column's own droppable, which stands for its end. */
export const COLUMN_DROP_PREFIX = "column-";
export const columnDropId = (column: PulseColumn) =>
  `${COLUMN_DROP_PREFIX}${column}`;

/** The distance from a point to a box, 0 inside it. */
function distanceTo(box: Box, point: Point): number {
  const dx = Math.max(box.left - point.x, 0, point.x - (box.left + box.width));
  const dy = Math.max(box.top - point.y, 0, point.y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

/**
 * The column a point belongs to. Among the columns whose width holds the
 * point, the nearest one up or down, 0 inside it. With none, the nearest
 * column. Null only when there are no columns.
 */
export function pickColumn(
  columns: ReadonlyArray<{ id: PulseColumn; rect: Box }>,
  point: Point,
): PulseColumn | null {
  let best: { id: PulseColumn; d: number } | null = null;
  for (const { id, rect } of columns) {
    if (point.x < rect.left || point.x > rect.left + rect.width) continue;
    const d = distanceTo(rect, point);
    if (!best || d < best.d) best = { id, d };
  }
  if (best) return best.id;
  for (const { id, rect } of columns) {
    const d = distanceTo(rect, point);
    if (!best || d < best.d) best = { id, d };
  }
  return best?.id ?? null;
}

/**
 * Where a card goes among a column's other cards, given in order. In a list,
 * before the first card whose middle is below the point. In a grid, in
 * reading order: every card of the rows above the point's row, then the
 * cards of its row whose middle is left of the point. The rows split halfway
 * through the gap between them, and a point under the last row is the end.
 */
export function insertionIndex(
  cards: readonly Box[],
  point: Point,
  mode: ColumnMode,
): number {
  if (cards.length === 0) return 0;
  if (mode === "list") {
    const index = cards.findIndex(
      (card) => point.y < card.top + card.height / 2,
    );
    return index === -1 ? cards.length : index;
  }

  const rows: { top: number; bottom: number; start: number; cards: Box[] }[] =
    [];
  cards.forEach((card, index) => {
    const row = rows[rows.length - 1];
    if (row && Math.abs(card.top - row.top) <= ROW_TOLERANCE) {
      row.cards.push(card);
      row.bottom = Math.max(row.bottom, card.top + card.height);
    } else {
      rows.push({
        top: card.top,
        bottom: card.top + card.height,
        start: index,
        cards: [card],
      });
    }
  });
  if (point.y > rows[rows.length - 1].bottom) return cards.length;
  let r = 0;
  while (
    r < rows.length - 1 &&
    point.y > (rows[r].bottom + rows[r + 1].top) / 2
  ) {
    r++;
  }
  const row = rows[r];
  return (
    row.start +
    row.cards.filter((card) => card.left + card.width / 2 < point.x).length
  );
}

/**
 * The columns in the order the eye reads them: row by row from the top,
 * left to right in a row. Focus, Intelligence, Network from `xl`, and
 * Focus, Network, Intelligence at `lg` and on a phone. Boxes that all sit
 * at 0 (a test without layout) keep the order they came in.
 */
export function visualColumnOrder(
  columns: ReadonlyArray<{ id: PulseColumn; rect: Box }>,
): PulseColumn[] {
  return [...columns]
    .sort((a, b) =>
      Math.abs(a.rect.top - b.rect.top) > ROW_TOLERANCE
        ? a.rect.top - b.rect.top
        : a.rect.left - b.rect.left,
    )
    .map((column) => column.id);
}

/** An arrow key, as a direction in the columns. */
export type KeyStep = "up" | "down" | "left" | "right";

/**
 * One keyboard step for a card that is being moved. Up and down move it one
 * place earlier or later in its column, and past either end into the column
 * before or after it in reading order. Left and right move it to the column
 * before or after, at the same place or that column's end. Null when there
 * is nowhere to go.
 */
export function keyboardStep(
  visible: VisibleColumns,
  cardId: PulseCardId,
  step: KeyStep,
  order: readonly PulseColumn[],
): DropPlace | null {
  const from = columnOf(visible, cardId);
  if (!from) return null;
  const index = visible[from].indexOf(cardId);
  const others = (column: PulseColumn) =>
    visible[column].filter((id) => id !== cardId);
  const at = order.indexOf(from);
  const before = at > 0 ? order[at - 1] : undefined;
  const after = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;

  switch (step) {
    case "down":
      if (index < others(from).length)
        return { column: from, index: index + 1 };
      return after ? { column: after, index: 0 } : null;
    case "up":
      if (index > 0) return { column: from, index: index - 1 };
      return before ? { column: before, index: others(before).length } : null;
    case "right":
      return after
        ? { column: after, index: Math.min(index, others(after).length) }
        : null;
    case "left":
      return before
        ? { column: before, index: Math.min(index, others(before).length) }
        : null;
  }
}

/**
 * The droppable id that stands for a place: the card the moved card goes
 * before, or the column's own droppable for its end.
 */
export function overIdFor(
  visible: VisibleColumns,
  cardId: PulseCardId,
  place: DropPlace,
): string {
  const others = visible[place.column].filter((id) => id !== cardId);
  return others[place.index] ?? columnDropId(place.column);
}

/** The place a droppable id stands for, or null for an id it does not know. */
export function targetFor(
  visible: VisibleColumns,
  cardId: PulseCardId,
  overId: string,
): DropPlace | null {
  if (overId.startsWith(COLUMN_DROP_PREFIX)) {
    const column = overId.slice(COLUMN_DROP_PREFIX.length) as PulseColumn;
    if (!PULSE_COLUMNS.includes(column)) return null;
    return {
      column,
      index: visible[column].filter((id) => id !== cardId).length,
    };
  }
  const column = columnOf(visible, overId);
  if (!column) return null;
  if (overId === cardId) {
    return { column, index: visible[column].indexOf(cardId) };
  }
  return {
    column,
    index: visible[column]
      .filter((id) => id !== cardId)
      .indexOf(overId as PulseCardId),
  };
}

/**
 * Where the keyboard aims the preview for a step: the top left corner the
 * card's slot will have at `place`, worked out from the boxes as they are
 * now, with the slot still in its old place. A card that moves later in its
 * own column lands under the card it passes, which rises by a slot and a
 * gap. A card that moves earlier takes the top of the card it passes. In
 * another column it takes the top of the card it goes before, or sits a gap
 * under the last card, or at the top of an empty column. Null when a box it
 * needs is missing.
 */
export function slotAim(
  visible: VisibleColumns,
  cardId: PulseCardId,
  place: DropPlace,
  boxOf: (id: string) => Box | undefined,
  gap: number,
  slotHeight: number,
): Point | null {
  const others = visible[place.column].filter((id) => id !== cardId);
  const current = visible[place.column].indexOf(cardId);
  if (current !== -1 && place.index > current) {
    const passed = boxOf(others[place.index - 1]);
    return passed
      ? { x: passed.left, y: passed.top + passed.height - slotHeight }
      : null;
  }
  const next = others[place.index];
  if (next) {
    const box = boxOf(next);
    return box ? { x: box.left, y: box.top } : null;
  }
  const last = others[others.length - 1];
  if (last) {
    const box = boxOf(last);
    return box ? { x: box.left, y: box.top + box.height + gap } : null;
  }
  const column = boxOf(columnDropId(place.column));
  return column ? { x: column.left + 4, y: column.top + 4 } : null;
}

/** Where a card is: its column, and its place counted from 1 of how many. */
export function positionOf(
  visible: VisibleColumns,
  cardId: PulseCardId,
): { column: PulseColumn; position: number; total: number } | null {
  const column = columnOf(visible, cardId);
  if (!column) return null;
  return {
    column,
    position: visible[column].indexOf(cardId) + 1,
    total: visible[column].length,
  };
}
