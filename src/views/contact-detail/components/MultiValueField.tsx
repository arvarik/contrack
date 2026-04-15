import React, { useState, useId } from 'react';
import { toast } from 'sonner';
import { X, GripVertical, MapPin as MapPinIcon } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { cn } from '../../../lib/utils';

export interface MultiValueItem {
  id?: string;
  value: string;
  label: string;
}

export const EMAIL_LABELS  = ['work', 'personal', 'other'] as const;
export const PHONE_LABELS  = ['mobile', 'work', 'home', 'other'] as const;
export const ADDR_LABELS   = ['home', 'work', 'other'] as const;

/**
 * Shows an undo toast for 7 seconds with a shrinking timer bar.
 * If user clicks Undo, the callback is called to restore the data.
 */
const showUndoToast = (label: string, onUndo: () => void) => {
  toast(label, {
    duration: 7000,
    action: {
      label: 'Undo',
      onClick: onUndo,
    },
  });
};

// ---------------------------------------------------------------------------
// Sortable Row — individual draggable item
// ---------------------------------------------------------------------------
const SortableRow = ({
  item,
  idx,
  totalCount,
  labelOptions,
  onLabelChange,
  onRemove,
  isAddress,
}: {
  item: MultiValueItem & { _sortId: string };
  idx: number;
  totalCount: number;
  labelOptions: readonly string[];
  onLabelChange: (idx: number, label: string) => void;
  onRemove: (idx: number) => void;
  isAddress?: boolean;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item._sortId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-start gap-1.5 group/item rounded-lg transition-colors py-0.5',
        isDragging && 'opacity-60 bg-primary/5 shadow-lg',
      )}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <CustomSelect
            value={item.label}
            onChange={newLabel => onLabelChange(idx, newLabel)}
            options={labelOptions}
            className="text-[10px] uppercase tracking-widest bg-surface-container hover:bg-surface-container-high px-2 py-0.5 rounded font-bold text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary/30 shrink-0 cursor-pointer flex items-center gap-1"
          />
          {/* Primary indicator for first address */}
          {isAddress && idx === 0 && (
            <span className="flex items-center gap-0.5 text-[9px] uppercase tracking-widest text-primary font-bold opacity-70">
              <MapPinIcon className="w-2.5 h-2.5" /> map pin
            </span>
          )}
          <button
            onClick={() => onRemove(idx)}
            className="opacity-0 group-hover/item:opacity-60 hover:!opacity-100 text-rose-500 p-0.5 rounded transition-opacity shrink-0"
            title="Remove"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {isAddress ? (
          <AddressDisplay value={item.value} />
        ) : (
          <span className="text-sm font-medium text-on-surface break-all">
            {item.value}
          </span>
        )}
      </div>

      {/* Drag handle — right side, only show when multiple items */}
      {totalCount > 1 && (
        <button
          className={cn(
            'mt-1 p-0.5 rounded text-on-surface-variant/30 hover:text-on-surface-variant cursor-grab active:cursor-grabbing shrink-0 touch-none',
            'opacity-0 group-hover/item:opacity-100 transition-opacity',
            'lg:opacity-40 lg:group-hover/item:opacity-100',
          )}
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Smart Address Display — breaks on commas, no mid-word cuts
// ---------------------------------------------------------------------------
const AddressDisplay = ({ value }: { value: string }) => {
  // Split by comma to create separate addressable parts
  const parts = value.split(',').map((p: string) => p.trim()).filter(Boolean);

  if (parts.length <= 1) {
    // Fallback: single segment, use normal word-break
    return (
      <span className="text-sm font-medium text-on-surface break-words">
        {value}
      </span>
    );
  }

  return (
    <span className="text-sm font-medium text-on-surface">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <span className="inline whitespace-nowrap">{part}</span>
          {i < parts.length - 1 && <span className="text-on-surface-variant/50">, </span>}
        </React.Fragment>
      ))}
    </span>
  );
};


// ---------------------------------------------------------------------------
// MultiValueField — Main component with DnD reorder support
// ---------------------------------------------------------------------------
export const MultiValueField = ({
  items,
  onSave,
  labelOptions,
  emptyPlaceholder,
  addMoreLabel = 'Add another',
  inputPlaceholder,
  isAddress = false,
}: {
  items: MultiValueItem[];
  onSave: (items: { value: string; label: string }[]) => void;
  labelOptions: readonly string[];
  emptyPlaceholder: string;
  addMoreLabel?: string;
  inputPlaceholder: string;
  isAddress?: boolean;
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputLabel, setInputLabel] = useState(labelOptions[0] || 'work');
  const [isAdding, setIsAdding] = useState(false);

  // Generate stable sort IDs for dnd-kit
  const prefix = useId();
  const itemsWithIds = items.map((item, i) => ({
    ...item,
    _sortId: item.id || `${prefix}-${i}`,
  }));

  // Sensors for both pointer (desktop) and touch (mobile)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const toSavable = (arr: MultiValueItem[]) =>
    arr.map(i => ({ value: i.value, label: i.label }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = itemsWithIds.findIndex(i => i._sortId === active.id);
    const newIndex = itemsWithIds.findIndex(i => i._sortId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    onSave(toSavable(reordered));

    // Notify user if the primary address changed (affects map pin)
    if (isAddress && (oldIndex === 0 || newIndex === 0)) {
      const newPrimary = reordered[0];
      toast.success(`Map pin updated to: ${newPrimary.value.split(',').slice(0, 2).join(',')}`, {
        duration: 3000,
      });
    }
  };

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) { setIsAdding(false); return; }
    onSave([...toSavable(items), { value: trimmed, label: inputLabel }]);
    setInputValue('');
    setInputLabel(labelOptions[0] || 'work');
    setIsAdding(false);
  };

  const handleRemove = (idx: number) => {
    const removed = items[idx];
    const before = toSavable(items);
    onSave(toSavable(items.filter((_, i) => i !== idx)));
    showUndoToast(`Removed "${removed.value}"`, () => onSave(before));
  };

  const handleChangeLabel = (idx: number, newLabel: string) =>
    onSave(items.map((item, i) => ({ value: item.value, label: i === idx ? newLabel : item.label })));

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={itemsWithIds.map(i => i._sortId)}
            strategy={verticalListSortingStrategy}
          >
            {itemsWithIds.map((item, idx) => (
              <SortableRow
                key={item._sortId}
                item={item}
                idx={idx}
                totalCount={items.length}
                labelOptions={labelOptions}
                onLabelChange={handleChangeLabel}
                onRemove={handleRemove}
                isAddress={isAddress}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {isAdding ? (
        <div className="flex flex-col gap-1 mt-0.5">
          <CustomSelect
            value={inputLabel}
            onChange={setInputLabel}
            options={labelOptions}
            className="text-[10px] uppercase tracking-widest bg-surface-container hover:bg-surface-container-high px-2 py-0.5 rounded font-bold text-on-surface-variant focus:outline-none shrink-0 w-fit cursor-pointer flex items-center gap-1 relative z-10"
          />
          <input
            autoFocus
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
              if (e.key === 'Escape') { setIsAdding(false); setInputValue(''); }
            }}
            onBlur={handleAdd}
            placeholder={inputPlaceholder}
            className="w-full text-sm bg-surface-container-high rounded px-2 py-1 border-none focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1 text-sm text-on-surface-variant opacity-50 italic text-left hover:opacity-80 transition-opacity py-0.5 group/add"
        >
          {items.length === 0 ? (
            <span>{emptyPlaceholder}</span>
          ) : (
            <span>{addMoreLabel}</span>
          )}
        </button>
      )}
    </div>
  );
};
