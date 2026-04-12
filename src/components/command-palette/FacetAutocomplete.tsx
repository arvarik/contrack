/**
 * FacetAutocomplete — Dropdown autocomplete for facet prefix values.
 *
 * Shown when user types a prefix like `role:` (no value yet) or `role:eng` (partial value).
 * Sources values from the slim contact cache — no API calls needed.
 *
 * @module components/command-palette/FacetAutocomplete
 */
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSlimContactsForSearch } from '../../api/contacts';
import type { FacetField, FacetFilter } from '../../hooks/useQueryTokenizer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FacetAutocompleteProps {
  /** Currently active prefix field (e.g., 'role') */
  field: FacetField;
  /** Partially typed value (e.g., 'eng' for 'role:eng') */
  partial: string;
  /** Called when user selects a suggestion */
  onSelect: (filter: FacetFilter) => void;
  /** Called when user dismisses without selecting */
  onDismiss: () => void;
}

// ─── Preset suggestions for non-text fields ───────────────────────────────────

const SCORE_PRESETS = [
  { label: 'High (≥80)',   value: '80',  operator: '>' as const },
  { label: 'Medium (≥50)', value: '50',  operator: '>' as const },
  { label: 'Low (≤30)',    value: '30',  operator: '<' as const },
];

const UPDATED_PRESETS = [
  { label: 'Last month',      value: '1m',  operator: '<' as const },
  { label: 'Last 3 months',   value: '3m',  operator: '<' as const },
  { label: 'Stale (>3 months)', value: '3m', operator: '>' as const },
  { label: 'Very stale (>6 months)', value: '6m', operator: '>' as const },
];

// ─── Component ────────────────────────────────────────────────────────────────

export const FacetAutocomplete: React.FC<FacetAutocompleteProps> = ({
  field,
  partial,
  onSelect,
  onDismiss,
}) => {
  const { data: slimContacts } = useSlimContactsForSearch();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // ── Build suggestions from slim cache ───────────────────────────────────
  const suggestions = useMemo(() => {
    if (field === 'score') {
      return SCORE_PRESETS
        .filter(p => !partial || p.value.includes(partial) || p.label.toLowerCase().includes(partial.toLowerCase()))
        .map(p => ({ label: p.label, filter: { field, value: p.value, operator: p.operator } as FacetFilter }));
    }

    if (field === 'updated') {
      return UPDATED_PRESETS
        .filter(p => !partial || p.value.includes(partial) || p.label.toLowerCase().includes(partial.toLowerCase()))
        .map(p => ({ label: p.label, filter: { field, value: p.value, operator: p.operator } as FacetFilter }));
    }

    if (!slimContacts?.length) return [];

    // Extract unique values for the field
    let values: string[] = [];

    switch (field) {
      case 'role':
        values = [...new Set(slimContacts.map(c => c.role).filter(Boolean) as string[])];
        break;
      case 'company':
        values = [...new Set(slimContacts.map(c => c.company).filter(Boolean) as string[])];
        break;
      case 'location':
        values = [...new Set(slimContacts.map(c => c.location).filter(Boolean) as string[])];
        break;
      case 'industry':
        values = [...new Set(slimContacts.map(c => c.industry).filter(Boolean) as string[])];
        break;
      case 'tag':
        values = [...new Set(slimContacts.flatMap(c => c.tags.map(t => t.tag)))];
        break;
      default:
        return [];
    }

    // Filter by partial match and sort alphabetically
    const filtered = values
      .filter(v => !partial || v.toLowerCase().includes(partial.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 8);

    return filtered.map(v => ({
      label: v,
      filter: { field, value: v } as FacetFilter,
    }));
  }, [field, partial, slimContacts]);

  // ── Reset selection on suggestions change ───────────────────────────────
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length, partial]);

  // ── Keyboard navigation ─────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const selected = suggestions[selectedIndex];
      if (selected) onSelect(selected.filter);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    }
  }, [suggestions, selectedIndex, onSelect, onDismiss]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  if (suggestions.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.1 }}
        className="mx-4 mb-1 rounded-xl bg-surface-container-lowest shadow-lg ring-1 ring-black/5 overflow-hidden"
      >
        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60 bg-surface-container-low/50">
          {field} values
        </div>
        <div className="py-1 max-h-[200px] overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={`${s.filter.field}-${s.filter.value}-${i}`}
              onClick={() => onSelect(s.filter)}
              onMouseDown={(e) => e.preventDefault()}
              className={`
                w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2
                ${i === selectedIndex
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface hover:bg-surface-container-low'
                }
              `}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/40 w-16 shrink-0">
                {field}:
              </span>
              <span className="truncate font-medium">{s.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
