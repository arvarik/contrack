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
import { DURATION, EASE } from "../../lib/motion";
import { TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * A pill's tone, from the one map (`.agent/STYLE.md`, "Tones"). A facet that
 * describes a person (a role, a company, a place, a tag) means nothing good
 * or bad, so it is neutral. `tracked` takes the primary wash, the one the
 * Track button wears when it is on. A facet that failed, such as a place that
 * did not resolve, takes the error. It used to be a colour per field, eleven
 * hues that meant nothing and fell to 2.3:1 on the dark panel.
 */
const pillTone = (filter: FacetFilter): Tone =>
  filter.error ? "error" : filter.field === "tracked" ? "primary" : "neutral";

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
        {filters.map((filter, i) => (
          <motion.button
            key={`${filter.field}-${filter.value}-${i}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            onClick={() => onRemove(i)}
            className={cn(
              "hit-area state-layer inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors group",
              TONE_WASH[pillTone(filter)],
            )}
          >
            {/* Secondary by weight, not by opacity: the pill's ink at 60
                percent fell under AA on every wash. */}
            <span className="font-medium">{filter.field}:</span>
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
        ))}
      </AnimatePresence>
    </div>
  );
};
