import React, { useEffect, useRef, useState } from 'react';
import { Pencil, ChevronDown, Check } from 'lucide-react';
import { Modal } from './ui/Modal';
import { cn } from '../lib/utils';
import { LABEL } from '../lib/styles';

// ---------------------------------------------------------------------------
// BulkEditFieldModal — pick a field + value to apply to many selected contacts.
//
// Phase-3 fixes:
//   1. The field-selector dropdown previously used a hard-coded dark palette
//      (`bg-[#242424] text-gray-200`) that clashed with the light design
//      system. Replaced with design-token surfaces and click-outside dismissal.
//   2. Every interactive control now meets the 44-px touch-target minimum
//      (Apple HIG / WCAG 2.5.5 AAA), preventing tap-target misses on phones.
//   3. The input now uses `text-base` on mobile to suppress iOS Safari's
//      auto-zoom-on-focus behaviour that would jolt the modal layout.
// ---------------------------------------------------------------------------

interface Field {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'number';
}

const EDITABLE_FIELDS: Field[] = [
  { key: 'role',        label: 'Role / Title',     placeholder: 'e.g. Senior Engineer',   type: 'text' },
  { key: 'company',     label: 'Company',          placeholder: 'e.g. Acme Corp',         type: 'text' },
  { key: 'industry',    label: 'Industry',         placeholder: 'e.g. Technology',        type: 'text' },
  { key: 'location',    label: 'Location',         placeholder: 'e.g. San Francisco, CA', type: 'text' },
  { key: 'cadenceDays', label: 'Cadence (days)',   placeholder: 'e.g. 30',                type: 'number' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  onApply: (field: string, value: string | number) => void;
  isPending: boolean;
}

export const BulkEditFieldModal = ({ isOpen, onClose, selectedCount, onApply, isPending }: Props) => {
  const [selectedField, setSelectedField] = useState<Field>(EDITABLE_FIELDS[0]);
  const [value, setValue] = useState('');
  const [fieldDropdownOpen, setFieldDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside to close the dropdown. Without this the dropdown stayed
  // visible while the user clicked into the value input — confusing UX.
  useEffect(() => {
    if (!fieldDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setFieldDropdownOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [fieldDropdownOpen]);

  const handleApply = () => {
    if (!value.trim()) return;
    const finalVal = selectedField.type === 'number' ? Number(value) : value.trim();
    onApply(selectedField.key, finalVal);
  };

  const handleClose = () => {
    setValue('');
    setSelectedField(EDITABLE_FIELDS[0]);
    setFieldDropdownOpen(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Field">
      <div className="space-y-5 pt-2">
        <p className="text-sm sm:text-xs text-on-surface-variant">
          Apply a value to <span className="font-bold text-on-surface">{selectedCount}</span> selected contact{selectedCount !== 1 ? 's' : ''}.
        </p>

        {/* Field selector */}
        <div>
          <label className={cn(LABEL, 'block mb-2')}>Field to Edit</label>
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setFieldDropdownOpen(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={fieldDropdownOpen}
              // min-h-[44px] keeps this control touch-safe.
              className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-container-low text-sm font-semibold text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest transition-colors"
            >
              <span>{selectedField.label}</span>
              <ChevronDown className={cn("w-4 h-4 text-on-surface-variant transition-transform", fieldDropdownOpen && "rotate-180")} />
            </button>

            {fieldDropdownOpen && (
              <div
                role="listbox"
                // Design-system surface tokens (was hard-coded `bg-[#242424]`).
                // glass-panel + ring keeps the dropdown legible on top of the
                // modal's translucent backdrop.
                className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl bg-surface-container-lowest shadow-xl ring-1 ring-black/5 py-1 overflow-hidden"
              >
                {EDITABLE_FIELDS.map(field => {
                  const isActive = field.key === selectedField.key;
                  return (
                    <button
                      key={field.key}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setSelectedField(field);
                        setValue('');
                        setFieldDropdownOpen(false);
                      }}
                      // min-h-[44px] for touch; px-4 keeps the icon and label aligned.
                      className={cn(
                        "min-h-[44px] flex items-center justify-between w-full px-4 py-2.5 text-sm text-left transition-colors",
                        isActive
                          ? "text-primary font-bold bg-primary/10"
                          : "text-on-surface hover:bg-surface-container-low",
                      )}
                    >
                      <span>{field.label}</span>
                      {isActive && <Check className="w-4 h-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Value input */}
        <div>
          <label className={cn(LABEL, 'block mb-2')}>New Value</label>
          <input
            key={selectedField.key}
            autoFocus
            type={selectedField.type}
            inputMode={selectedField.type === 'number' ? 'numeric' : 'text'}
            min={selectedField.type === 'number' ? 1 : undefined}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && value.trim()) handleApply(); }}
            placeholder={selectedField.placeholder}
            // text-base on mobile suppresses iOS auto-zoom on focus.
            className="w-full bg-surface-container-low border-none rounded-xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>

        {/* Preview */}
        {value.trim() && (
          <div className="bg-primary/5 rounded-xl px-4 py-3 text-sm">
            <span className="text-on-surface-variant">Set </span>
            <span className="font-bold text-primary">{selectedField.label}</span>
            <span className="text-on-surface-variant"> → </span>
            <span className="font-bold text-on-surface">"{value.trim()}"</span>
            <span className="text-on-surface-variant"> for {selectedCount} contact{selectedCount !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Actions — stack on mobile, side-by-side on tablet+. */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button
            onClick={handleClose}
            // min-h-[44px] + py-3 keeps the secondary action touch-safe.
            className="flex-1 min-h-[44px] py-3 rounded-xl bg-surface-container-low font-bold text-sm text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!value.trim() || isPending}
            className="flex-1 min-h-[44px] py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 active:opacity-100 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Pencil className="w-4 h-4" />
            {isPending ? 'Applying…' : 'Apply to All'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
