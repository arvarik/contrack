import React, { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { CustomSelect } from '../CustomSelect';

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

export const MultiValueField = ({
  items,
  onSave,
  labelOptions,
  emptyPlaceholder,
  addMoreLabel = 'Add another',
  inputPlaceholder,
}: {
  items: MultiValueItem[];
  onSave: (items: { value: string; label: string }[]) => void;
  labelOptions: readonly string[];
  emptyPlaceholder: string;
  addMoreLabel?: string;
  inputPlaceholder: string;
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputLabel, setInputLabel] = useState(labelOptions[0] || 'work');
  const [isAdding, setIsAdding] = useState(false);

  const toSavable = (arr: MultiValueItem[]) =>
    arr.map(i => ({ value: i.value, label: i.label }));

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
      {items.map((item, idx) => (
        <div key={item.id ?? idx} className="flex flex-col gap-0.5 group/item">
          <div className="flex items-center gap-1.5">
            <CustomSelect
              value={item.label}
              onChange={newLabel => handleChangeLabel(idx, newLabel)}
              options={labelOptions}
              className="text-[10px] uppercase tracking-widest bg-surface-container hover:bg-surface-container-high px-2 py-0.5 rounded font-bold text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary/30 shrink-0 cursor-pointer flex items-center gap-1"
            />
            <button
              onClick={() => handleRemove(idx)}
              className="opacity-0 group-hover/item:opacity-60 hover:!opacity-100 text-rose-500 p-0.5 rounded transition-opacity shrink-0"
              title="Remove"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <span className="text-sm font-medium text-on-surface break-all">
            {item.value}
          </span>
        </div>
      ))}

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
