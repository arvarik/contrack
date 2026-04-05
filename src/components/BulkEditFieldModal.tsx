import React, { useState } from 'react';
import { Pencil, ChevronDown } from 'lucide-react';
import { Modal } from './ui/Modal';
import { cn } from '../lib/utils';
import { LABEL } from '../lib/styles';

// ---------------------------------------------------------------------------
// BulkEditFieldModal — lets the user pick a field + value for bulk update
// ---------------------------------------------------------------------------

interface Field {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'number';
}

const EDITABLE_FIELDS: Field[] = [
  { key: 'role',        label: 'Role / Title',    placeholder: 'e.g. Senior Engineer', type: 'text' },
  { key: 'company',     label: 'Company',          placeholder: 'e.g. Acme Corp',       type: 'text' },
  { key: 'industry',    label: 'Industry',         placeholder: 'e.g. Technology',      type: 'text' },
  { key: 'location',    label: 'Location',         placeholder: 'e.g. San Francisco, CA', type: 'text' },
  { key: 'cadenceDays', label: 'Cadence (days)',   placeholder: 'e.g. 30',              type: 'number' },
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

  const handleApply = () => {
    if (!value.trim()) return;
    const finalVal = selectedField.type === 'number' ? Number(value) : value.trim();
    onApply(selectedField.key, finalVal);
  };

  const handleClose = () => {
    setValue('');
    setSelectedField(EDITABLE_FIELDS[0]);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Field">
      <div className="space-y-5 pt-2">
        <p className="text-xs text-on-surface-variant">
          Apply a value to <span className="font-bold text-on-surface">{selectedCount}</span> selected contact{selectedCount !== 1 ? 's' : ''}.
        </p>

        {/* Field selector */}
        <div>
          <label className={cn(LABEL, 'block mb-2')}>Field to Edit</label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFieldDropdownOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-container text-sm font-semibold text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <span>{selectedField.label}</span>
              <ChevronDown className={cn("w-4 h-4 text-on-surface-variant transition-transform", fieldDropdownOpen && "rotate-180")} />
            </button>

            {fieldDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl bg-[#242424] shadow-xl ring-1 ring-white/10 py-1 overflow-hidden">
                {EDITABLE_FIELDS.map(field => (
                  <button
                    key={field.key}
                    onClick={() => {
                      setSelectedField(field);
                      setValue('');
                      setFieldDropdownOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full px-4 py-2.5 text-sm text-left transition-colors",
                      field.key === selectedField.key
                        ? "text-primary font-bold bg-primary/15"
                        : "text-gray-200 hover:bg-primary/10 hover:text-primary"
                    )}
                  >
                    {field.label}
                  </button>
                ))}
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
            min={selectedField.type === 'number' ? 1 : undefined}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && value.trim()) handleApply(); }}
            placeholder={selectedField.placeholder}
            className="w-full bg-surface-container border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
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

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl bg-surface-container font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!value.trim() || isPending}
            className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Pencil className="w-4 h-4" />
            {isPending ? 'Applying...' : 'Apply to All'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
