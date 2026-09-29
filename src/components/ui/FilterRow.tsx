/**
 * FilterRow: one row of filter pills, one choice among them, each pill with
 * the number of contacts it would show.
 *
 * ```
 * CONTACTS   (All 5824) (Tracked 79) (Has links 824) (Has email 3270)
 * ```
 *
 * The Enrichment page has two rows (who, and how their research stands),
 * and the Tracked contacts page has two (tracking, and the last talk). A
 * pill counts what it would show beside the other row's choice, so a person
 * sees how big a list is before they press it.
 *
 * 1. The row is a `role="group"` named by its label, and each pill is a
 *    toggle button with `aria-pressed`, so a screen reader hears the row's
 *    name and which pill is pressed.
 * 2. The pressed pill wears the selected tint (`filterPill`), not a filled
 *    button, like every filter pill in the app. The count is in the pill's
 *    ink at a lighter weight.
 * 3. The label sits above the pills on a phone, where the pills need the
 *    width, and before them from `sm`, level with their first line.
 *
 * @module components/ui/FilterRow
 */
import React from "react";
import { filterPill } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** One pill: its value, its words, and its glyph. */
export interface FilterPill<T> {
  id: T;
  label: string;
  icon: React.ReactNode;
}

/**
 * The label of a row of pills, on one line. From `sm` it is a column wide
 * enough for "Last spoke", so the pills of every row start at one edge.
 */
const ROW_LABEL =
  "shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant sm:w-[5.75rem] sm:pt-2";

export interface FilterRowProps<T extends string> {
  /** The row's name, such as "Contacts". It also makes the label's id. */
  label: string;
  pills: readonly FilterPill<T>[];
  /** The pressed pill. */
  value: T;
  /** The number each pill would show. A pill with none shows 0. */
  counts: ReadonlyMap<T, number>;
  onChange: (value: T) => void;
  /** The start of the label's id, so two pages' rows never share one. */
  idPrefix: string;
}

export function FilterRow<T extends string>({
  label,
  pills,
  value,
  counts,
  onChange,
  idPrefix,
}: FilterRowProps<T>) {
  const labelId = `${idPrefix}-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
      <span id={labelId} className={ROW_LABEL}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-1 flex-wrap gap-1.5"
      >
        {pills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            aria-pressed={value === pill.id}
            onClick={() => onChange(pill.id)}
            className={cn("hit-area", filterPill(value === pill.id))}
          >
            {pill.icon}
            {pill.label}
            {/* The count in the pill's own ink, at a lighter weight than its
                words. At 70 percent opacity, a pressed pill's count measured
                under 4.5 to 1 on a card. */}
            <span className="font-medium tabular-nums">
              {counts.get(pill.id) ?? 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
