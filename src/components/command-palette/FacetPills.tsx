/**
 * The facet pills in the search box:
 *   [role:founder ×] [company:stripe ×] | Search text here...
 */
import React from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { FacetFilter } from "../../hooks/useQueryTokenizer";
import { DURATION, EASE } from "../../lib/motion";
import { TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";

/**
 * A pill's tone (`.agent/STYLE.md`, "Tones"). A facet that describes a
 * person is neutral. `tracked` takes the primary wash, as the Track button
 * does. A facet that failed, such as a place that did not resolve, takes
 * the error.
 */
const pillTone = (filter: FacetFilter): Tone =>
  filter.error ? "error" : filter.field === "tracked" ? "primary" : "neutral";

/** The value a pill shows: a place with its state, or the operator and value. */
const pillValue = (filter: FacetFilter): string => {
  if (filter.field !== "near") return `${filter.operator || ""}${filter.value}`;
  if (filter.error) return `${filter.value} (${filter.error})`;
  if (filter.resolving) return `${filter.value} (resolving…)`;
  return filter.km ? `${filter.value}/${filter.km}km` : filter.value;
};

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
    <div className="flex items-center gap-1.5 flex-wrap px-4 pt-3 pointer-fine:pt-2 pb-0">
      <AnimatePresence>
        {filters.map((filter, i) => (
          <motion.span
            key={`${filter.field}-${filter.value}-${i}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            className={cn(
              "inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] font-bold",
              TONE_WASH[pillTone(filter)],
            )}
          >
            {/* Secondary by weight, not by opacity: the pill's ink at 60
                percent fell under AA on every wash. */}
            <span className="font-medium">{filter.field}:</span>
            <span>{pillValue(filter)}</span>
            {/* Only the × removes it. The whole pill was the button, so a
                tap on its words, to read them, took the filter away. */}
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove filter ${filter.field}: ${pillValue(filter)}`}
              className="hit-area state-layer inline-flex items-center justify-center w-4 h-4 rounded"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
};
