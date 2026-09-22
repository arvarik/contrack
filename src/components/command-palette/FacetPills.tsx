/**
 * FacetPills — Visual pill components for locked facet filters.
 *
 * Renders inline in the search input area:
 *   [role:founder ×] [company:stripe ×] | Search text here...
 *
 * @module components/command-palette/FacetPills
 */
import React from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { FacetFilter } from "../../hooks/useQueryTokenizer";

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_COLORS: Record<string, string> = {
  role: "bg-blue-500/15 text-info ring-blue-500/20",
  company: "bg-violet-500/15 text-info ring-violet-500/20",
  location: "bg-emerald-500/15 text-success ring-emerald-500/20",
  industry: "bg-amber-500/15 text-warning ring-amber-500/20",
  tag: "bg-pink-500/15 text-pink-600 ring-pink-500/20",
  score: "bg-orange-500/15 text-warning ring-orange-500/20",
  updated: "bg-teal-500/15 text-success ring-teal-500/20",
  list: "bg-indigo-500/15 text-indigo-600 ring-indigo-500/20",
  near: "bg-cyan-500/15 text-cyan-600 ring-cyan-500/20",
  missing: "bg-rose-500/15 text-error ring-rose-500/20",
  tracked: "bg-primary/15 text-on-primary-wash ring-primary/20",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface FacetPillsProps {
  filters: FacetFilter[];
  onRemove: (index: number) => void;
}

export const FacetPills: React.FC<FacetPillsProps> = ({
  filters,
  onRemove,
}) => {
  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap px-4 pt-3 sm:pt-2 pb-0">
      <AnimatePresence>
        {filters.map((filter, i) => {
          const isError = Boolean(filter.error);
          const pillColor = isError
            ? "bg-rose-500/15 text-error ring-rose-500/20"
            : FIELD_COLORS[filter.field] ||
              "bg-surface-container-high text-on-surface-variant ring-surface-container-highest";

          return (
            <motion.button
              key={`${filter.field}-${filter.value}-${i}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.12 }}
              onClick={() => onRemove(i)}
              className={`
                hit-area inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold
                ring-1 ring-inset cursor-pointer transition-all
                hover:ring-2 group
                ${pillColor}
              `}
            >
              <span className="opacity-60">{filter.field}:</span>
              <span>
                {filter.field === "near"
                  ? filter.error
                    ? `${filter.value} (${filter.error})`
                    : filter.resolving
                      ? `${filter.value} (resolving…)`
                      : filter.km
                        ? `${filter.value}/${filter.km}km`
                        : filter.value
                  : `${filter.operator || ""}${filter.value}`}
              </span>
              <X className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" />
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
