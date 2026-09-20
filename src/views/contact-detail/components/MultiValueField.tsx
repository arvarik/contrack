/**
 * MultiValueField: the rows of a field that holds several values, a
 * contact's addresses, emails or phones.
 *
 * Each row follows the `Field` pattern: the value, its label chip, a kebab.
 *
 * 1. The value edits in place (`EditableField`). A save replaces that one row
 *    and saves the whole list, because the server keeps the list in order.
 * 2. The label chip is a native select.
 * 3. The kebab holds "Make primary", "Show on map" (addresses) and "Remove".
 *    The first row is the primary one, so it has no "Make primary". For
 *    addresses the primary one places the map pin.
 * 4. Order. A drag handle shows while the row's kebab is open, and dnd-kit
 *    drags it by pointer or touch. From the keyboard, Alt+ArrowUp and
 *    Alt+ArrowDown move the row that has focus, and a polite live region says
 *    where it went.
 * 5. "+ Add" opens a label select and an input under the rows, and under
 *    `afterRows` when the field has one.
 *
 * Focus does not fall to the page. The rows change only when the server
 * answers, and the answer can give every row a new id, which mounts new rows.
 * So after an edit, a move, a label change or a remove, focus goes to the
 * same place in the new rows once they show the change.
 *
 * @module views/contact-detail/components/MultiValueField
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, GripVertical, MapPin, Star, Trash2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CustomSelect } from "../../../components/ui/CustomSelect";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { cn } from "../../../lib/utils";
import { EditableField } from "./EditableField";
import { AddButton, FIELD_VALUE, showUndoToast } from "./Field";

export interface MultiValueItem {
  id?: string;
  value: string;
  label: string;
}

export const EMAIL_LABELS = ["work", "personal", "other"] as const;
export const PHONE_LABELS = ["mobile", "work", "home", "other"] as const;
export const ADDR_LABELS = ["home", "work", "other"] as const;

/**
 * A 44 px tap box for the label select on a phone, around a 32 px chip.
 *
 * `hit-area` cannot do this: browsers draw no `::after` on a `<select>`, and
 * a tap beside the select does not open it. So the select itself is 44 px
 * tall, and 6 px of transparent border above and below, with the fill
 * clipped to the padding box, leave 32 px of visible chip. From `sm` a
 * pointer needs no tap box, and the chip is 32 px with no border.
 */
const LABEL_SELECT_TAP_BOX =
  "min-h-[44px] border-y-[6px] border-transparent bg-clip-padding rounded-lg sm:min-h-[32px] sm:border-y-0";

/** The label chip. Uppercase like every chip, at the 11 px floor. */
const LABEL_CHIP = cn(
  "text-[11px] uppercase tracking-widest bg-surface-container hover:bg-surface-container-high px-2 py-0.5 font-bold text-on-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 shrink-0 cursor-pointer",
  LABEL_SELECT_TAP_BOX,
);

/**
 * An address as far as its first two parts, "1 Main St, Springfield", which
 * is enough to tell two addresses apart without reading out a postcode.
 */
const shortAddress = (value: string): string =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ") || value;

/** The part of a row that takes focus back after a save. */
type FocusPart = "value" | "label" | "menu";

const PART_SELECTOR: Record<FocusPart, string> = {
  value: "[data-row-value] button",
  label: "select",
  menu: "[data-row-menu] [aria-haspopup='menu']",
};

/** Where focus goes once the rows show a change. */
interface FocusTarget {
  /** True when the rows on screen already show the change. */
  ready: (rows: readonly MultiValueItem[]) => boolean;
  /** The row that takes focus, or "add" when no row is left. */
  row: (rows: readonly MultiValueItem[]) => number | "add";
  part: FocusPart;
  /** True for Alt+Arrow. The moved row then shows its drag handle. */
  byKey?: boolean;
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

interface RowProps {
  item: MultiValueItem & { sortId: string };
  index: number;
  count: number;
  noun: string;
  labelOptions: readonly string[];
  isAddress: boolean;
  mapHref?: string;
  /** True after Alt+Arrow placed this row, until focus leaves it. */
  moved: boolean;
  onEdit: (index: number, value: string) => void;
  onLabelChange: (index: number, label: string) => void;
  onMakePrimary: (index: number) => void;
  onRemove: (index: number) => void;
  /** Focus left the row. */
  onLeave: (index: number) => void;
}

const SortableRow = ({
  item,
  index,
  count,
  noun,
  labelOptions,
  isAddress,
  mapHref,
  moved,
  onEdit,
  onLabelChange,
  onMakePrimary,
  onRemove,
  onLeave,
}: RowProps) => {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.sortId });
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * True from a press on the handle until the press ends. The press that
   * grabs the handle is also a press outside the open kebab, so the kebab
   * closes. Without this the handle would leave the page under the finger.
   */
  const [grabbed, setGrabbed] = useState(false);

  useEffect(() => {
    if (!grabbed) return;
    const release = () => setGrabbed(false);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    return () => {
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
    };
  }, [grabbed]);

  // Four rows can sit in one card, so every name says which value it is for.
  const name = isAddress ? shortAddress(item.value) : item.value;
  const showHandle = count > 1 && (menuOpen || grabbed || isDragging || moved);

  const actions: ActionMenuItem[] = [];
  if (index > 0) {
    actions.push({
      id: "primary",
      label: "Make primary",
      icon: Star,
      onSelect: () => onMakePrimary(index),
    });
  }
  // Every address row leads to the same pin, because the contact has one.
  if (isAddress && mapHref) {
    actions.push({
      id: "map",
      label: "Show on map",
      icon: MapPin,
      to: mapHref,
    });
  }
  actions.push({
    id: "remove",
    label: "Remove",
    icon: Trash2,
    danger: true,
    onSelect: () => onRemove(index),
  });

  return (
    <div
      ref={setNodeRef}
      data-row-index={index}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onLeave(index);
      }}
      className={cn(
        // An address is long, so it takes its own line and the chip and the
        // kebab sit under it. An email or a phone shares one line with them
        // when the card has room.
        // gap-x-3 on a phone keeps the tap boxes apart.
        "flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-2 rounded-lg transition-colors",
        isDragging && "opacity-60 bg-primary/5 shadow-lg",
      )}
    >
      <div
        data-row-value=""
        // An email or a phone asks for 11 rem before it shares the line. In
        // the 300 px Details column that moves the chip and the kebab under
        // it, and the address keeps whole words on one line.
        className={cn("min-w-0", isAddress ? "basis-full" : "flex-[1_1_11rem]")}
      >
        <EditableField
          value={item.value}
          onSave={(next) => onEdit(index, next)}
          placeholder={`Add ${noun}`}
          inputLabel={`Edit ${noun}`}
          // An email or a phone number has no spaces to wrap at.
          className={cn(FIELD_VALUE, "max-w-full", !isAddress && "break-all")}
        />
      </div>
      <CustomSelect
        value={item.label}
        onChange={(label) => onLabelChange(index, label)}
        options={labelOptions}
        ariaLabel={`Label for ${name}`}
        className={LABEL_CHIP}
      />
      {/* The primary address places the pin. A status, not a link: the
          kebab's "Show on map" is the way to the map. */}
      {isAddress && index === 0 && mapHref && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-on-surface-variant">
          <Check aria-hidden="true" className="w-3.5 h-3.5" />
          Map pin
        </span>
      )}
      <div
        data-row-menu=""
        className="ml-auto flex items-center gap-3 sm:gap-1"
      >
        {showHandle && (
          <button
            type="button"
            // The keyboard moves a row with Alt+Arrow, so the handle is for a
            // pointer and a finger only.
            tabIndex={-1}
            aria-label={`Drag ${name} to reorder`}
            onPointerDownCapture={() => setGrabbed(true)}
            {...listeners}
            className="hit-area p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical aria-hidden="true" className="w-4 h-4" />
          </button>
        )}
        <ActionMenu
          label={`Actions for ${name}`}
          items={actions}
          onOpenChange={setMenuOpen}
          iconClassName="w-4 h-4"
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

export interface MultiValueFieldProps {
  items: MultiValueItem[];
  /** Saves the whole list, in order. The first value is the primary one. */
  onSave: (items: { value: string; label: string }[]) => void;
  labelOptions: readonly string[];
  /**
   * One value's name in lower case: "address", "email", "phone". It names
   * the edit input ("Edit email") and the new value's input ("New email").
   */
  noun: string;
  /** The add button's accessible name, for example "Add location". */
  addLabel: string;
  inputPlaceholder: string;
  isAddress?: boolean;
  /**
   * Where an address row's "Show on map" item goes. Left out when the
   * contact has no coordinates, and the rows then offer no map item and no
   * "Map pin" status.
   */
  mapHref?: string;
  /**
   * Something that belongs to the rows and shows under them: the mini map
   * and its caption, for addresses. The add control stays last, so a new
   * value goes in under it.
   */
  afterRows?: React.ReactNode;
}

export const MultiValueField = ({
  items,
  onSave,
  labelOptions,
  noun,
  addLabel,
  inputPlaceholder,
  isAddress = false,
  mapHref,
  afterRows,
}: MultiValueFieldProps) => {
  const firstLabel = labelOptions[0] || "work";
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLabel, setDraftLabel] = useState(firstLabel);
  /** The row Alt+Arrow placed. It shows its drag handle. */
  const [movedRow, setMovedRow] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const addForm = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /** True when a key closed the add form. Focus then goes to "+ Add". */
  const focusAdd = useRef(false);
  /**
   * True while the add form is open. A browser can send a blur when the
   * form leaves the page after Enter, and that blur must not add the value
   * a second time.
   */
  const addOpen = useRef(false);
  const focusAfterSave = useRef<FocusTarget | null>(null);

  // Stable sort ids for dnd-kit. A value with no id yet uses its place.
  const prefix = useId();
  const rows = items.map((item, i) => ({
    ...item,
    sortId: item.id || `${prefix}-${i}`,
  }));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  useEffect(() => {
    if (adding || !focusAdd.current) return;
    focusAdd.current = false;
    addButton.current?.focus();
  }, [adding]);

  useEffect(() => {
    const target = focusAfterSave.current;
    if (!target || !target.ready(items)) return;
    focusAfterSave.current = null;
    // The person went somewhere else while the save was out. Focus stays
    // with them.
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      !wrapper.current?.contains(active)
    )
      return;
    const row = target.row(items);
    if (row === "add") {
      addButton.current?.focus();
      return;
    }
    if (target.byKey) setMovedRow(row);
    wrapper.current
      ?.querySelector<HTMLElement>(
        `[data-row-index="${row}"] ${PART_SELECTOR[target.part]}`,
      )
      ?.focus();
  }, [items]);

  const toSavable = (list: readonly MultiValueItem[]) =>
    list.map((i) => ({ value: i.value, label: i.label }));

  const reorder = (from: number, to: number) => {
    const reordered = arrayMove(items, from, to);
    onSave(toSavable(reordered));
    setAnnouncement(`Moved to position ${to + 1} of ${items.length}`);
    // The server places the pin from the primary address.
    if (isAddress && (from === 0 || to === 0)) {
      toast.success(`Map pin updated to: ${shortAddress(reordered[0].value)}`, {
        duration: 3000,
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.sortId === active.id);
    const to = rows.findIndex((r) => r.sortId === over.id);
    if (from === -1 || to === -1) return;
    reorder(from, to);
  };

  const moveByKey = (from: number, by: -1 | 1, part: FocusPart) => {
    const to = from + by;
    if (to < 0 || to >= items.length) return;
    const value = items[from].value;
    focusAfterSave.current = {
      ready: (list) => list[to]?.value === value,
      row: () => to,
      part,
      byKey: true,
    };
    reorder(from, to);
  };

  const makePrimary = (index: number) => {
    const value = items[index].value;
    focusAfterSave.current = {
      ready: (list) => list[0]?.value === value,
      row: () => 0,
      part: "menu",
    };
    reorder(index, 0);
  };

  const edit = (index: number, value: string) => {
    const next = value.trim();
    // An empty value is not a remove. Remove is in the kebab, with undo.
    if (!next) return;
    focusAfterSave.current = {
      ready: (list) => list[index]?.value === next,
      row: () => index,
      part: "value",
    };
    onSave(
      items.map((item, i) => ({
        value: i === index ? next : item.value,
        label: item.label,
      })),
    );
  };

  const relabel = (index: number, label: string) => {
    focusAfterSave.current = {
      ready: (list) => list[index]?.label === label,
      row: () => index,
      part: "label",
    };
    onSave(
      items.map((item, i) => ({
        value: item.value,
        label: i === index ? label : item.label,
      })),
    );
  };

  const remove = (index: number) => {
    const removed = items[index];
    const before = toSavable(items);
    const left = items.length - 1;
    focusAfterSave.current = {
      ready: (list) => list.length === left,
      row: (list) => (list.length === 0 ? "add" : Math.min(index, left - 1)),
      part: "menu",
    };
    onSave(toSavable(items.filter((_, i) => i !== index)));
    showUndoToast(`Removed "${removed.value}"`, () => onSave(before));
  };

  const openAdd = () => {
    addOpen.current = true;
    setAdding(true);
  };

  const closeAdd = (byKey: boolean) => {
    addOpen.current = false;
    setAdding(false);
    setDraft("");
    setDraftLabel(firstLabel);
    if (byKey) focusAdd.current = true;
  };

  const commitAdd = (byKey: boolean) => {
    if (!addOpen.current) return;
    const value = draft.trim();
    if (value) onSave([...toSavable(items), { value, label: draftLabel }]);
    closeAdd(byKey);
  };

  return (
    <div
      ref={wrapper}
      className="flex flex-col gap-1"
      // Capture, so the kebab does not also open on Alt+ArrowDown. The
      // select and the inputs keep their own arrow keys, and so does an
      // open menu.
      onKeyDownCapture={(event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        const target = event.target as HTMLElement;
        if (target.closest("input, select, textarea, [role='menu']")) return;
        const row = target.closest<HTMLElement>("[data-row-index]");
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        moveByKey(
          Number(row.dataset.rowIndex),
          event.key === "ArrowUp" ? -1 : 1,
          target.closest("[data-row-menu]") ? "menu" : "value",
        );
      }}
    >
      {items.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rows.map((r) => r.sortId)}
            strategy={verticalListSortingStrategy}
          >
            {rows.map((item, index) => (
              <SortableRow
                key={item.sortId}
                item={item}
                index={index}
                count={items.length}
                noun={noun}
                labelOptions={labelOptions}
                isAddress={isAddress}
                mapHref={mapHref}
                moved={movedRow === index}
                onEdit={edit}
                onLabelChange={relabel}
                onMakePrimary={makePrimary}
                onRemove={remove}
                onLeave={(left) =>
                  setMovedRow((current) => (current === left ? null : current))
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {afterRows}

      {adding ? (
        <div
          ref={addForm}
          className="flex flex-wrap items-center gap-2"
          // Leaving the form adds what was typed. Moving between the label
          // select and the input stays inside the form.
          onBlur={(event) => {
            if (addForm.current?.contains(event.relatedTarget as Node | null))
              return;
            commitAdd(false);
          }}
        >
          <CustomSelect
            value={draftLabel}
            onChange={setDraftLabel}
            options={labelOptions}
            ariaLabel={`Label for new ${noun}`}
            className={LABEL_CHIP}
          />
          <input
            aria-label={`New ${noun}`}
            // Appears only after the person pressed "+ Add".
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                commitAdd(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeAdd(true);
              }
            }}
            placeholder={inputPlaceholder}
            // 16 px on a phone, so iOS does not zoom in on focus.
            className="flex-1 min-w-[10rem] min-h-[44px] sm:min-h-0 text-base sm:text-sm bg-surface-container-high rounded px-2 py-1 border-none focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>
      ) : (
        <AddButton ref={addButton} label={addLabel} onClick={openAdd} />
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
};
