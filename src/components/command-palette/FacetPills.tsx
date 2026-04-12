/**
 * FacetPills — Visual pill components for locked facet filters.
 *
 * Renders inline in the search input area:
 *   [role:founder ×] [company:stripe ×] | Search text here...
 *
 * @module components/command-palette/FacetPills
 */
import React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { FacetFilter } from '../../hooks/useQueryTokenizer';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_COLORS: Record<string, string> = {
  role:     'bg-blue-500/15 text-blue-600 ring-blue-500/20',
  company:  'bg-violet-500/15 text-violet-600 ring-violet-500/20',
  location: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/20',
  industry: 'bg-amber-500/15 text-amber-600 ring-amber-500/20',
  tag:      'bg-pink-500/15 text-pink-600 ring-pink-500/20',
  score:    'bg-orange-500/15 text-orange-600 ring-orange-500/20',
  updated:  'bg-teal-500/15 text-teal-600 ring-teal-500/20',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface FacetPillsProps {
  filters: FacetFilter[];
  onRemove: (index: number) => void;
}

export const FacetPills: React.FC<FacetPillsProps> = ({ filters, onRemove }) => {
  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap px-4 pt-2 pb-0">
      <AnimatePresence>
        {filters.map((filter, i) => (
          <motion.button
            key={`${filter.field}-${filter.value}-${i}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.12 }}
            onClick={() => onRemove(i)}
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold
              ring-1 ring-inset cursor-pointer transition-all
              hover:ring-2 group
              ${FIELD_COLORS[filter.field] || 'bg-surface-container-high text-on-surface-variant ring-surface-container-highest'}
            `}
          >
            <span className="opacity-60">{filter.field}:</span>
            <span>{filter.operator || ''}{filter.value}</span>
            <X className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
};
