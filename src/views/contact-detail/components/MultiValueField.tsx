/**
 * The rows of a field that holds several values: addresses, emails or phones.
 * Each row is a value that edits in place, a label chip and a kebab. The first
 * row is the primary one, and for addresses it places the map pin. A drag
 * handle shows while the kebab is open, and Alt+ArrowUp and Alt+ArrowDown
 * move the focused row. Every change saves the whole list, because the server
 * keeps it in order.
 *
 * The server's answer can give every row a new id, which mounts new rows. So
 * after a change, focus goes to the same place in the new rows once they show
 * the change, and does not fall to the page.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { scrollBehavior } from "../../../lib/a11y";
import { toast } from "sonner";
import {
  Check,
  GripVertical,
  MapPin,
  MessageCircle,
  Star,
  Trash2,
} from "lucide-react";
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
import { INLINE_INPUT } from "../../../lib/styles";
import { mailtoHref, smsHref, telHref } from "../../../lib/contactLinks";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { TOUCH_QUERY } from "../../../lib/platform";
import type { MapLink } from "../../map/mapLink";
import { EditableField, INPUT_KIND } from "./EditableField";
import { AddButton, FIELD_VALUE, showUndoToast } from "./Field";

export interface MultiValueItem {
  id?: string;
  value: string;
  label: string;
}

export const EMAIL_LABELS = ["work", "personal", "other"] as const;
export const PHONE_LABELS = ["mobile", "work", "home", "other"] as const;
export const ADDR_LABELS = ["home", "work", "other"] as const;

/** A value a tap can act on: an email writes, a phone calls. */
type ValueKind = "email" | "phone";

const INPUT_OF: Record<ValueKind, keyof typeof INPUT_KIND> = {
  email: "email",
  phone: "tel",
};

const HREF_OF: Record<ValueKind, (value: string) => string | null> = {
  email: mailtoHref,
  phone: telHref,
};

/** The label chip does not shrink beside a long value. */
const LABEL_CHIP = "shrink-0";

/** "1 Main St, Springfield": enough to tell addresses apart, no postal code. */
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
  label: "[role='combobox']",
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

interface RowProps {
  item: MultiValueItem & { sortId: string };
  index: number;
  count: number;
  noun: string;
  labelOptions: readonly string[];
  isAddress: boolean;
  kind?: ValueKind;
  mapLink?: MapLink;
  /** True after Alt+Arrow placed this row, until focus leaves it. */
  moved: boolean;
  onEdit: (index: number, value: string) => void;
  onLabelChange: (index: number, label: string) => void;
  onMakePrimary: (index: number) => void;
  onRemove: (index: number) => void;
  onLeave: (index: number) => void;
}

const SortableRow = ({
  item,
  index,
  count,
  noun,
  labelOptions,
  isAddress,
  kind,
  mapLink,
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
  // "Message" hands the number to the phone's messages app. With a mouse
  // there is often no app for `sms:`, and the item would do nothing.
  const touch = useMediaQuery(TOUCH_QUERY);
  // True while the handle is pressed. That press also closes the kebab, and
  // without this the handle would leave the page under the finger.
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
  // A text to the number, first: the value itself calls, and it is what a
  // person opens this menu for most.
  const sms = kind === "phone" && touch ? smsHref(item.value) : null;
  if (sms) {
    actions.push({
      id: "message",
      label: "Message",
      icon: MessageCircle,
      onSelect: () => window.location.assign(sms),
    });
  }
  if (index > 0) {
    actions.push({
      id: "primary",
      label: "Make primary",
      icon: Star,
      onSelect: () => onMakePrimary(index),
    });
  }
  // Every address row leads to the same pin, because the contact has one.
  if (isAddress && mapLink) {
    actions.push({
      id: "map",
      label: "Show on map",
      icon: MapPin,
      to: mapLink.to,
      state: mapLink.state,
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
        // An address takes its own line. An email or a phone shares one with
        // the chip and kebab when it fits. gap-x-3 keeps phone tap boxes apart.
        "flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-2 rounded-lg transition-colors",
        isDragging && "opacity-60 bg-primary/5 shadow-lg",
      )}
    >
      <div
        data-row-value=""
        // An email or a phone needs 11 rem to share the line, so in the 300 px
        // Details column the chip and kebab wrap under it.
        className={cn("min-w-0", isAddress ? "basis-full" : "flex-[1_1_11rem]")}
      >
        <EditableField
          value={item.value}
          onSave={(next) => onEdit(index, next)}
          placeholder={`Add ${noun}`}
          inputLabel={`Edit ${noun}`}
          kind={kind && INPUT_OF[kind]}
          href={kind && HREF_OF[kind](item.value)}
          // An email has no spaces to wrap at: it breaks inside only where
          // it would overflow, never at any letter (`break-all`).
          className={cn(FIELD_VALUE, "max-w-full", !isAddress && "break-words")}
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
      {isAddress && index === 0 && mapLink && (
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
            // Pointer and touch only: the keyboard moves rows with Alt+Arrow.
            tabIndex={-1}
            aria-label={`Drag ${name} to reorder`}
            onPointerDownCapture={() => setGrabbed(true)}
            {...listeners}
            className="hit-area state-layer p-1.5 rounded-lg text-on-surface-variant cursor-grab active:cursor-grabbing touch-none"
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

interface MultiValueFieldProps {
  items: MultiValueItem[];
  /** Saves the whole list, in order. The first value is the primary one. */
  onSave: (items: { value: string; label: string }[]) => void;
  labelOptions: readonly string[];
  /** One value's name in lower case, for "Edit email" and "New email". */
  noun: string;
  /** The add button's accessible name, for example "Add location". */
  addLabel: string;
  inputPlaceholder: string;
  isAddress?: boolean;
  /** Each value is a `mailto:` or `tel:` link, and inputs open that keyboard. */
  kind?: ValueKind;
  /** "Show on map" target. Left out with no coordinates: no map item or pin. */
  mapLink?: MapLink;
  /** Shows under the rows, such as the mini map. The add control stays last. */
  afterRows?: React.ReactNode;
  /**
   * A new number opens the add form and scrolls to it (the Research card's
   * "Add a city"). `onOpenRequestDone` spends it, so a later mount does not
   * open the form again.
   */
  openRequest?: number;
  /** The label the requested form starts with: "work" for a work email. */
  openLabel?: string;
  onOpenRequestDone?: () => void;
}

export const MultiValueField = ({
  items,
  onSave,
  labelOptions,
  noun,
  addLabel,
  inputPlaceholder,
  isAddress = false,
  kind,
  mapLink,
  afterRows,
  openRequest,
  openLabel,
  onOpenRequestDone,
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
  // True while the add form is open, so the blur a browser can send after
  // Enter does not add the value a second time.
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

  // The input autofocuses as it appears. The field scrolls to the middle of
  // the view, so the person sees where the typing goes.
  useEffect(() => {
    if (openRequest === undefined) return;
    addOpen.current = true;
    setAdding(true);
    if (openLabel) setDraftLabel(openLabel);
    wrapper.current?.scrollIntoView?.({
      block: "center",
      behavior: scrollBehavior(),
    });
    onOpenRequestDone?.();
  }, [openRequest, openLabel, onOpenRequestDone]);

  useEffect(() => {
    const target = focusAfterSave.current;
    if (!target || !target.ready(items)) return;
    focusAfterSave.current = null;
    // Focus moved elsewhere during the save: leave it there.
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
      // Capture, so the kebab does not also open on Alt+ArrowDown. Inputs,
      // open menus and open label lists keep their arrow keys.
      onKeyDownCapture={(event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "input, select, textarea, [role='menu'], [role='listbox']",
          )
        )
          return;
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
                kind={kind}
                mapLink={mapLink}
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
            {...(kind && INPUT_KIND[INPUT_OF[kind]])}
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
            className={cn(INLINE_INPUT, "flex-1 min-w-[10rem]")}
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
