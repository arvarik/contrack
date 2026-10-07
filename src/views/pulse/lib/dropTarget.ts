/**
 * Where a card lands in customize mode, as pure geometry.
 *
 * The pointer decides, not the cards' boxes: dnd-kit's `closestCenter` put an
 * 800 px Up next's center 400 px from the pointer. First the column whose
 * width holds the pointer (else the nearest), then the place before the first
 * other card whose middle is below the pointer. The moved card is left out of
 * the count and its slot stays in the layout, so a pointer resting on a line
 * does not make the card jump back and forth.
 *
 * A place goes to dnd-kit as a droppable id: the card the moved card goes
 * before, or the column itself for its end.
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

interface Point {
  x: number;
  y: number;
}

export type ColumnMode = "list" | "grid";

/** A column and an index among its other cards. */
export interface DropPlace {
  column: PulseColumn;
  index: number;
}

/** Tops closer than this share a row. */
const ROW_TOLERANCE = 4;

/** The id of a column's own droppable, which stands for its end. */
const COLUMN_DROP_PREFIX = "column-";
export const columnDropId = (column: PulseColumn) =>
  `${COLUMN_DROP_PREFIX}${column}`;

function distanceTo(box: Box, point: Point): number {
  const dx = Math.max(box.left - point.x, 0, point.x - (box.left + box.width));
  const dy = Math.max(box.top - point.y, 0, point.y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

/**
 * The nearest column whose width holds the point, so the space under a short
 * column belongs to it. With none, the nearest column.
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
 * Where a card goes among a column's other cards. In a list, before the first
 * card whose middle is below the point. In a grid, in reading order: the rows
 * above, then the cards of the point's row whose middle is left of it. Rows
 * split halfway through the gap between them.
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
 * The columns in reading order, row by row and left to right. Boxes that all
 * sit at 0 (a test without layout) keep their order.
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

export type KeyStep = "up" | "down" | "left" | "right";

/**
 * One keyboard step. Up and down move one place, and past either end into
 * the column before or after in reading order. Left and right keep the index,
 * or take that column's end.
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

export function overIdFor(
  visible: VisibleColumns,
  cardId: PulseCardId,
  place: DropPlace,
): string {
  const others = visible[place.column].filter((id) => id !== cardId);
  return others[place.index] ?? columnDropId(place.column);
}

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
 * The top left corner the slot will have at `place`, from the boxes as they
 * are now, with the slot still in its old place. A card that moves later in
 * its own column lands at the bottom of the card it passes, which rises.
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

/** A card's column, and its place counted from 1. */
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
