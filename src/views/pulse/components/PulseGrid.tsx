/**
 * PulseGrid: the three columns, and moving a card between them in customize
 * mode.
 *
 * A mouse picks a card up after a short move, a finger after a hold on the
 * grip, and the keyboard with Space or Enter. Two sensors, because the
 * pointer sensor would claim the finger with the mouse's rule. The grip keeps
 * `touch-action: manipulation`, so a flick that starts on it still scrolls.
 *
 * In the air the card folds to a slot (`DRAG_SLOT_HEIGHT`), which is the drop
 * target, and a preview in `DragOverlay` follows the pointer. The move lives
 * in `draft`, a copy of the visible columns, and each target change moves the
 * card one step through `moveCard`. The drop becomes one reducer action
 * (`dropAction`). A dropped draft stays on screen until the saved layout
 * comes back, so the card never flashes in its old place.
 *
 * The pointer, not the card's box, picks the target (`lib/dropTarget.ts`).
 * After each step the detection holds its answer until the new layout is
 * measured, so a step never runs on old boxes and the card cannot bounce.
 *
 * Cards slide by FLIP on `transform` (`lib/flip.ts`). The cards are memoized
 * elements from the page, so a drag step renders only the grid. Reduced
 * motion drops the slides and the flight.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  getScrollableAncestors,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type AutoScrollOptions,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragPendingEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type MeasuringConfiguration,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { cn } from "../../../lib/utils";
import { LABEL } from "../../../lib/styles";
import { DURATION, prefersReducedMotion } from "../../../lib/motion";
import {
  CARD_TITLES,
  COLUMN_NAMES,
  PULSE_COLUMNS,
  dropAction,
  moveCard,
  sameColumns,
  type PulseCardId,
  type PulseColumn,
  type PulseLayoutAction,
  type VisibleColumns,
} from "../lib/layout";
import {
  columnDropId,
  insertionIndex,
  keyboardStep,
  overIdFor,
  pickColumn,
  positionOf,
  slotAim,
  targetFor,
  visualColumnOrder,
  type Box,
  type ColumnMode,
  type DropPlace,
  type KeyStep,
} from "../lib/dropTarget";
import { EASE_CSS, createFlip } from "../lib/flip";
import {
  COLUMN_CLASSES,
  DRAG_GRIP_OFFSET,
  DRAG_PREVIEW_MAX_WIDTH,
  DRAG_PREVIEW_MIN_WIDTH,
  DRAG_SLOT_HEIGHT,
  GRID_CLASSES,
} from "../lib/pulseStyles";
import { SortableCard } from "./SortableCard";
import { DragPreview } from "./DragPreview";

/**
 * Source order. The grid's `order-*` classes place the columns on screen,
 * and the drag reads their places from their boxes, not from this.
 */
const COLUMN_SOURCE_ORDER: readonly PulseColumn[] = [
  "focus",
  "intel",
  "network",
];

/** The gap between two cards in a column (`gap-6`), in px. */
const CARD_GAP = 24;

const MOUSE_OPTIONS = { activationConstraint: { distance: 4 } };

/** A finger that moves past the tolerance inside the hold is a scroll. */
const TOUCH_OPTIONS = { activationConstraint: { delay: 200, tolerance: 5 } };

/** Measure droppables always, so a drag's first frame knows the columns. */
const MEASURING: MeasuringConfiguration = {
  droppable: { strategy: MeasuringStrategy.Always },
};

/**
 * Slower and nearer the edge than dnd-kit's default, which ran the page out
 * from under a card meant for a drop near the bottom of the window.
 */
const AUTO_SCROLL: AutoScrollOptions = {
  threshold: { x: 0.2, y: 0.15 },
  acceleration: 6,
};

const ARROWS: Record<string, KeyStep | undefined> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** What a screen reader hears on the grip, after its label. */
const INSTRUCTIONS = {
  draggable:
    "To move this card, press Space or Enter. Arrow Up and Arrow Down move it one place at a time. Arrow Left and Arrow Right move it to the column beside it. Press Space or Enter to drop it, or Escape to put it back. The Move menu beside this handle moves a card without dragging.",
};

/** The card waits hidden under the preview and fades in once it lands. */
const DROP_ANIMATION: DropAnimation = {
  duration: DURATION.slow * 1000,
  easing: EASE_CSS,
  sideEffects: ({ active }) => {
    const node = active.node;
    node.style.opacity = "0";
    return () => {
      node.style.opacity = "";
      node.animate?.([{ opacity: 0 }, { opacity: 1 }], {
        duration: DURATION.base * 1000,
        easing: EASE_CSS,
      });
    };
  },
};

/** The preview's margin from the window's edges, in px. */
const WINDOW_MARGIN = 8;

/**
 * Keeps the preview inside the window. The pointer, not the preview, still
 * picks the target. dnd-kit's `restrictToWindowEdges` lives in a package the
 * app does not ship.
 */
const keepInWindow: Modifier = ({
  transform,
  draggingNodeRect,
  windowRect,
}) => {
  if (!draggingNodeRect || !windowRect) return transform;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  return {
    ...transform,
    x: clamp(
      transform.x,
      windowRect.left + WINDOW_MARGIN - draggingNodeRect.left,
      windowRect.left +
        windowRect.width -
        WINDOW_MARGIN -
        (draggingNodeRect.left + draggingNodeRect.width),
    ),
    y: clamp(
      transform.y,
      windowRect.top + WINDOW_MARGIN - draggingNodeRect.top,
      windowRect.top +
        windowRect.height -
        WINDOW_MARGIN -
        (draggingNodeRect.top + draggingNodeRect.height),
    ),
  };
};
const OVERLAY_MODIFIERS = [keepInWindow];

/**
 * No wider than the card's left edge to the grip, so a preview with its grip
 * under the pointer starts inside the card. On a phone the grip sits 120 px
 * from the card's right edge, and a full-width preview began off screen.
 */
function previewWidth(
  card: { left: number; width: number } | null,
  pointer: { x: number } | null,
): number {
  if (!card) return DRAG_PREVIEW_MAX_WIDTH;
  const room = pointer
    ? pointer.x - card.left + DRAG_GRIP_OFFSET.right
    : card.width;
  return Math.round(
    Math.max(DRAG_PREVIEW_MIN_WIDTH, Math.min(DRAG_PREVIEW_MAX_WIDTH, room)),
  );
}

const titleOf = (id: UniqueIdentifier) =>
  CARD_TITLES[id as PulseCardId] ?? String(id);

/** "Network, position 2 of 3", for the live region. */
const placeWords = (at: NonNullable<ReturnType<typeof positionOf>>) =>
  `${COLUMN_NAMES[at.column]}, position ${at.position} of ${at.total}`;

/** Each column's layout, read from the page: the Intelligence grid at `lg`. */
function readModes(
  root: HTMLElement | null,
): Partial<Record<PulseColumn, ColumnMode>> {
  const modes: Partial<Record<PulseColumn, ColumnMode>> = {};
  root?.querySelectorAll<HTMLElement>("[data-pulse-column]").forEach((node) => {
    modes[node.dataset.pulseColumn as PulseColumn] =
      getComputedStyle(node).display === "grid" ? "grid" : "list";
  });
  return modes;
}

/**
 * Hands up dnd-kit's re-measure. The context changes on every drag frame, so
 * the grid does not read it.
 */
function MeasureBridge({
  measureRef,
}: {
  measureRef: React.MutableRefObject<
    ((ids: UniqueIdentifier[]) => void) | null
  >;
}) {
  const { measureDroppableContainers } = useDndContext();
  useLayoutEffect(() => {
    measureRef.current = measureDroppableContainers;
  }, [measureDroppableContainers, measureRef]);
  return null;
}

/**
 * One column. Its droppable stands for its end, so a card let go under the
 * last card or in an empty column lands there. The skeleton and the route
 * fallback share `COLUMN_CLASSES`. The 4 px inset leaves room for a shadow.
 */
const DroppableColumn = ({
  id,
  isEditing,
  isEmpty,
  children,
}: {
  id: PulseColumn;
  isEditing: boolean;
  isEmpty: boolean;
  children: React.ReactNode;
}) => {
  const { setNodeRef } = useDroppable({
    id: columnDropId(id),
    disabled: !isEditing,
    data: { column: id },
  });
  return (
    <div
      ref={setNodeRef}
      data-pulse-column={id}
      className={cn("flex flex-col gap-6 rounded-2xl p-1", COLUMN_CLASSES[id])}
    >
      {/* The name its Move menu items say. */}
      {isEditing && (
        <p className={cn(LABEL, "px-1 -mb-3 lg:col-span-2")}>
          {COLUMN_NAMES[id]}
        </p>
      )}
      {children}
      {isEmpty && isEditing && (
        <div className="flex items-center justify-center h-16 rounded-2xl border-2 border-dashed border-outline-variant text-xs text-on-surface-variant font-medium">
          Drop cards here
        </div>
      )}
    </div>
  );
};

interface PulseGridProps {
  layout: VisibleColumns;
  isEditing: boolean;
  /** Each card's element, built by the page and memoized on its data. */
  cards: Record<PulseCardId, React.ReactNode>;
  onHide: (cardId: string) => void;
  onMoveToColumn: (cardId: string, targetColumn: PulseColumn) => void;
  onMoveStep: (cardId: string, direction: -1 | 1) => void;
  /** A drop that changed the layout, as one reducer action to save. */
  onDrop: (action: PulseLayoutAction) => void;
  /** True while a card is in the air, so the page's letter keys wait. */
  draggingRef?: React.MutableRefObject<boolean>;
}

/** The card in the air. */
interface DragState {
  id: PulseCardId;
  width: number;
  /** The pointer that picked it up, in viewport px. Null for the keyboard. */
  origin: { x: number; y: number } | null;
}

export const PulseGrid = ({
  layout,
  isEditing,
  cards,
  onHide,
  onMoveToColumn,
  onMoveStep,
  onDrop,
  draggingRef,
}: PulseGridProps) => {
  const [draft, setDraft] = useState<VisibleColumns | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // The height the lifted card gave back. Without it a page scrolled to its
  // end shrinks, scrolls up, and moves the slot out from under the pointer.
  const [spacer, setSpacer] = useState(0);
  const visible = draft ?? layout;

  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<((ids: UniqueIdentifier[]) => void) | null>(null);
  const flip = useMemo(() => createFlip(() => gridRef.current), []);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Read by the collision detection, keyboard and announcements, which run
  // inside dnd-kit, outside React's render.
  const live = useRef({
    /** The draft as of the last step, ahead of React's state by a render. */
    draft: null as VisibleColumns | null,
    modes: {} as Partial<Record<PulseColumn, ColumnMode>>,
    keyboardPlace: null as DropPlace | null,
    /** Hold the answer until the layout after a step is measured. */
    hold: false,
    lastOverId: null as string | null,
    /** Where the card was picked up, and where it last was said to be. */
    origin: null as ReturnType<typeof positionOf>,
    announced: "",
    /** Where it was let go, and whether that moved it. */
    dropped: null as ReturnType<typeof positionOf>,
    moved: false,
    /** A dropped draft that waits on screen for the saved layout. */
    held: false,
    /** The column a step moved the card into, and its top before the step. */
    anchor: null as { column: PulseColumn; top: number } | null,
  });

  const columnNode = useCallback(
    (column: PulseColumn) =>
      gridRef.current?.querySelector<HTMLElement>(
        `[data-pulse-column="${column}"]`,
      ) ?? null,
    [],
  );

  const collisionDetection: CollisionDetection = useCallback(
    ({ active, droppableRects, pointerCoordinates }) => {
      const s = live.current;
      const current = s.draft;
      if (!current) return [];
      // Only the pointer waits for a step's layout to be measured. The
      // keyboard's place comes from the draft, so no key press is lost.
      if (pointerCoordinates && s.hold && s.lastOverId) {
        return [{ id: s.lastOverId }];
      }
      const cardId = active.id as PulseCardId;
      let place: DropPlace | null = null;
      if (pointerCoordinates) {
        const columns = PULSE_COLUMNS.flatMap((id) => {
          const rect = droppableRects.get(columnDropId(id));
          return rect ? [{ id, rect }] : [];
        });
        const column = pickColumn(columns, pointerCoordinates);
        if (column) {
          const boxes = current[column]
            .filter((id) => id !== cardId)
            .map((id) => droppableRects.get(id));
          if (boxes.every(Boolean)) {
            place = {
              column,
              index: insertionIndex(
                boxes as Box[],
                pointerCoordinates,
                s.modes[column] ?? "list",
              ),
            };
          }
        }
      } else {
        place = s.keyboardPlace;
      }
      if (!place) return s.lastOverId ? [{ id: s.lastOverId }] : [];
      const overId = overIdFor(current, cardId, place);
      s.lastOverId = overId;
      return [{ id: overId }];
    },
    [],
  );

  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback(
    (event, { active, context }) => {
      const step = ARROWS[event.code];
      if (!step) return undefined;
      event.preventDefault();
      const s = live.current;
      const current = s.draft;
      if (!current || !active) return undefined;
      const cardId = active as PulseCardId;
      const rects = context.droppableRects;
      const order = visualColumnOrder(
        PULSE_COLUMNS.flatMap((id) => {
          const rect = rects.get(columnDropId(id));
          return rect ? [{ id, rect }] : [];
        }),
      );
      const place = keyboardStep(
        current,
        cardId,
        step,
        order.length === PULSE_COLUMNS.length ? order : PULSE_COLUMNS,
      );
      if (!place) return undefined;
      s.keyboardPlace = place;
      // Aim at the slot's next place. Any answer moves the drag, which makes
      // dnd-kit ask for the target again.
      const aim = slotAim(
        current,
        cardId,
        place,
        (id) => rects.get(id),
        CARD_GAP,
        DRAG_SLOT_HEIGHT,
      );
      const here = context.collisionRect;
      return aim ?? (here ? { x: here.left, y: here.top + 1 } : undefined);
    },
    [],
  );

  const reduced = prefersReducedMotion();
  const keyboardOptions = useMemo(
    () => ({
      coordinateGetter: keyboardCoordinates,
      scrollBehavior: (reduced ? "auto" : "smooth") as ScrollBehavior,
    }),
    [keyboardCoordinates, reduced],
  );
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor, keyboardOptions),
  );

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => {
        const at = live.current.origin;
        return at
          ? `Picked up ${titleOf(active.id)}. It is in ${placeWords(at)}.`
          : `Picked up ${titleOf(active.id)}.`;
      },
      onDragOver: ({ active }) => {
        const s = live.current;
        const at = s.draft && positionOf(s.draft, active.id as PulseCardId);
        if (!at) return undefined;
        const words = placeWords(at);
        // A new drop target is not always a new place: say a place once.
        if (words === s.announced) return undefined;
        s.announced = words;
        return `${titleOf(active.id)} moves to ${words}.`;
      },
      onDragEnd: ({ active }) => {
        const { dropped, moved } = live.current;
        if (!dropped) return `Dropped ${titleOf(active.id)}.`;
        return moved
          ? `Dropped ${titleOf(active.id)} in ${placeWords(dropped)}.`
          : `Dropped ${titleOf(active.id)}. It stays in ${placeWords(dropped)}.`;
      },
      onDragCancel: ({ active }) => {
        const at = live.current.origin;
        return at
          ? `Canceled. ${titleOf(active.id)} stays in ${placeWords(at)}.`
          : `Canceled. ${titleOf(active.id)} stays where it was.`;
      },
    }),
    [],
  );
  const accessibility = useMemo(
    () => ({ announcements, screenReaderInstructions: INSTRUCTIONS }),
    [announcements],
  );

  /** Clears the drag's own state. The draft is the caller's to keep or drop. */
  const endDrag = useCallback(() => {
    const s = live.current;
    s.draft = null;
    s.keyboardPlace = null;
    s.hold = false;
    s.lastOverId = null;
    setDrag(null);
    setSpacer(0);
    if (draggingRef) draggingRef.current = false;
  }, [draggingRef]);

  const handleDragPending = useCallback(({ id }: DragPendingEvent) => {
    setPendingId((prev) => (prev === String(id) ? prev : String(id)));
  }, []);
  const handleDragAbort = useCallback(() => setPendingId(null), []);

  const handleDragStart = useCallback(
    ({ active, activatorEvent }: DragStartEvent) => {
      const cardId = active.id as PulseCardId;
      const base = visibleRef.current;
      const s = live.current;
      const origin = positionOf(base, cardId);
      flip.capture();
      s.draft = base;
      s.modes = readModes(gridRef.current);
      s.keyboardPlace = null;
      // The card folds in this render. Hold its place until that is measured.
      s.hold = true;
      s.lastOverId = origin
        ? overIdFor(base, cardId, {
            column: origin.column,
            index: origin.position - 1,
          })
        : null;
      s.origin = origin;
      s.announced = origin ? placeWords(origin) : "";
      s.dropped = null;
      s.moved = false;
      s.held = false;
      // Read the box before it folds. dnd-kit fills `active.rect` only after
      // this handler, and until then it holds the last drag's box.
      const rect =
        gridRef.current
          ?.querySelector(`[data-flip-id="${cardId}"]`)
          ?.getBoundingClientRect() ?? null;
      const pointer = activatorEvent
        ? getEventCoordinates(activatorEvent)
        : null;
      setDraft(base);
      setDrag({
        id: cardId,
        width: previewWidth(rect, pointer),
        origin: pointer,
      });
      setPendingId(null);
      setSpacer(Math.max(0, (rect?.height ?? 0) - DRAG_SLOT_HEIGHT));
      if (draggingRef) draggingRef.current = true;
    },
    [draggingRef, flip],
  );

  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      const s = live.current;
      if (!over || !s.draft) return;
      const cardId = active.id as PulseCardId;
      const place = targetFor(s.draft, cardId, String(over.id));
      if (!place) return;
      const next = moveCard(s.draft, cardId, place.column, place.index);
      if (sameColumns(next, s.draft)) return;
      flip.capture();
      const target = columnNode(place.column);
      s.anchor = target
        ? { column: place.column, top: target.getBoundingClientRect().top }
        : null;
      s.draft = next;
      s.hold = true;
      setDraft(next);
    },
    [columnNode, flip],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const s = live.current;
      const cardId = active.id as PulseCardId;
      let final = s.draft;
      // The last target may not have had its step yet.
      if (final && over) {
        const place = targetFor(final, cardId, String(over.id));
        if (place) final = moveCard(final, cardId, place.column, place.index);
      }
      const action = final
        ? dropAction(layoutRef.current, final, cardId)
        : null;
      const from = s.origin;
      const to = final ? positionOf(final, cardId) : null;
      s.dropped = to;
      s.moved = Boolean(
        from &&
        to &&
        (from.column !== to.column || from.position !== to.position),
      );
      flip.capture();
      endDrag();
      if (final && action) {
        s.held = true;
        setDraft(final);
        onDrop(action);
      } else {
        setDraft(null);
      }
    },
    [endDrag, flip, onDrop],
  );

  const handleDragCancel = useCallback(() => {
    flip.capture();
    endDrag();
    setDraft(null);
  }, [endDrag, flip]);

  // After each render: keep the target column still, slide the moved cards,
  // and after a step, measure the new layout before the next step runs.
  useLayoutEffect(() => {
    // A card that leaves a column lifts whatever sits under it, and the place
    // under the pointer with it, so the card would chase one more step.
    // Scrolling by the same shift keeps the target column still on screen.
    const anchor = live.current.anchor;
    live.current.anchor = null;
    const node = anchor && columnNode(anchor.column);
    if (anchor && node) {
      const shift = node.getBoundingClientRect().top - anchor.top;
      const scroller = getScrollableAncestors(node)[0];
      if (scroller && Math.abs(shift) >= 1) scroller.scrollTop += shift;
    }
    flip.play();
    if (!live.current.hold) return;
    const ids: UniqueIdentifier[] = [
      ...PULSE_COLUMNS.map(columnDropId),
      ...PULSE_COLUMNS.flatMap((column) => visibleRef.current[column]),
    ];
    measureRef.current?.(ids);
    const frame = requestAnimationFrame(() => {
      live.current.hold = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [columnNode, draft, drag, flip]);

  // The saved layout is back: the dropped draft has done its job.
  useEffect(() => {
    if (!live.current.held) return;
    live.current.held = false;
    setDraft(null);
  }, [layout]);

  const at = drag ? positionOf(visible, drag.id) : null;
  // dnd-kit sizes the overlay to the lifted card (800 px for Up next), so the
  // preview sets its own size and puts its grip where the pointer pressed.
  // The keyboard has no pointer: the preview starts at the card's top left.
  const overlayStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!drag) return undefined;
    const size = { width: drag.width, height: "auto" };
    if (!drag.origin) return size;
    return {
      ...size,
      left: drag.origin.x - (drag.width - DRAG_GRIP_OFFSET.right),
      top: drag.origin.y - DRAG_GRIP_OFFSET.top,
    };
  }, [drag]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={MEASURING}
      autoScroll={AUTO_SCROLL}
      accessibility={accessibility}
      onDragPending={handleDragPending}
      onDragAbort={handleDragAbort}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <MeasureBridge measureRef={measureRef} />
      <div
        ref={gridRef}
        className={cn(GRID_CLASSES, drag && "cursor-grabbing")}
      >
        {COLUMN_SOURCE_ORDER.map((column) => (
          <DroppableColumn
            key={column}
            id={column}
            isEditing={isEditing}
            isEmpty={visible[column].length === 0}
          >
            {visible[column].map((cardId, index) => (
              <SortableCard
                key={cardId}
                cardId={cardId}
                column={column}
                index={index}
                totalInColumn={visible[column].length}
                isEditing={isEditing}
                isPending={pendingId === cardId}
                onHide={onHide}
                onMoveToColumn={onMoveToColumn}
                onMoveStep={onMoveStep}
              >
                {cards[cardId]}
              </SortableCard>
            ))}
          </DroppableColumn>
        ))}
      </div>
      {spacer > 0 && <div aria-hidden="true" style={{ height: spacer }} />}
      {createPortal(
        <DragOverlay
          zIndex={70}
          dropAnimation={reduced ? null : DROP_ANIMATION}
          modifiers={OVERLAY_MODIFIERS}
          style={overlayStyle}
          className="will-change-transform"
        >
          {drag && at ? (
            <DragPreview
              title={titleOf(drag.id)}
              column={COLUMN_NAMES[at.column]}
              position={at.position}
              total={at.total}
              width={drag.width}
            />
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
};
